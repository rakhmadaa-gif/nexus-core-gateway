// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Genyleap

pragma solidity 0.8.30;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IGenyAllocation} from "./interfaces/IGenyAllocation.sol";
import {IGenyBurnManager} from "./interfaces/IGenyBurnManager.sol";

/// @title GenyDAO
/// @author compez.eth
/// @notice Manages Genyleap Improvement Proposals (GIP) for decentralized governance.
/// @dev Voting: 20% quorum normal / 50% sensitive, 7-day voting. UUPS upgradable; owner expected to be multisig.
/// @custom:security-contact security@genyleap.com
contract GenyDAO is
    Initializable,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // Core addresses & params
    IVotes public token;                   // GENY token with IVotes
    address public burnManager;            // GenyBurnManager
    address public allocationManager;      // GenyAllocation
    uint32 public minProposingPowerNormalPercent;    // bps (0.1% = 10)
    uint32 public minProposingPowerSensitivePercent; // bps (1% = 100)
    uint256 public minVotingPower;                  // e.g., 256e18

    /// @notice Max number of actions (targets/values/calldatas items) in a single proposal.
    uint16 public maxActionsPerProposal; // default in initialize()
    /// @notice Max total calldata size across all actions in a proposal (bytes).
    uint32 public maxTotalCalldataBytes; // default in initialize()

    /// @notice Optional labels for proposers (UI/analytics)
    enum InvestorLabel { None, Founder, CoreInvestor, CommunityAdvocate, StandardHolder }

    /// @dev Proposal storage
    struct Proposal {
        address proposer;
        string description;
        uint48 startTime;
        uint48 endTime;
        uint96 forVotes;
        uint96 againstVotes;
        uint96 totalVotes;
        bool executed;
        bool isSensitive;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        uint256 snapshotBlock;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => InvestorLabel) public investorLabels;
    uint256 public proposalCount;

    // Quorum / bounds
    uint32 private constant QUORUM_NORMAL = 20_00;     // 20%
    uint32 private constant QUORUM_SENSITIVE = 50_00;  // 50%
    uint48 private constant VOTING_PERIOD = 7 days;
    uint32 private constant BURN_MAX_PERCENT = 10_00;  // 10%
    uint32 private constant MIN_PROPOSING_PERCENT_MIN = 1;      // 0.01%
    uint32 private constant MIN_PROPOSING_PERCENT_MAX = 1000;   // 10%
    uint256 private constant MIN_VOTING_POWER_MIN = 25 * 1e18;
    uint256 private constant MIN_VOTING_POWER_MAX = 2560 * 1e18;

    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address proposer,
        InvestorLabel proposerLabel,
        string description,
        bool isSensitive,
        uint48 startTime,
        uint256 snapshotBlock
    );
    event Voted(uint256 indexed proposalId, address voter, bool support, uint96 weight);
    event ProposalExecuted(uint256 indexed proposalId);
    event TokensBurned(uint256 indexed proposalId, uint256 amount);
    event MinProposingPowerPercentUpdated(bool isSensitive, uint32 oldPercent, uint32 newPercent);
    event MinVotingPowerUpdated(uint256 oldPower, uint256 newPower);
    event InvestorLabelUpdated(address indexed investor, InvestorLabel oldLabel, InvestorLabel newLabel);
    event MaxActionsPerProposalUpdated(uint16 oldValue, uint16 newValue);
    event MaxTotalCalldataBytesUpdated(uint32 oldValue, uint32 newValue);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the DAO contract.
    /// @param _token GENY token (IVotes)
    /// @param _owner Owner (multisig)
    /// @param _burnManager GenyBurnManager
    /// @param _allocationManager GenyAllocation
    function initialize(
        address _token,
        address _owner,
        address _burnManager,
        address _allocationManager
    ) external initializer {
        _validateAddresses(_token, _owner, _burnManager, _allocationManager);

        __Ownable2Step_init();
        _transferOwnership(_owner);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        token = IVotes(_token);
        burnManager = _burnManager;
        allocationManager = _allocationManager;

        minProposingPowerNormalPercent = 10;     // 0.1%
        minProposingPowerSensitivePercent = 100; // 1%
        minVotingPower = 256 * 1e18;

        // DoS guards for execution loop & calldata bloat
        maxActionsPerProposal = 16;     // sane default
        maxTotalCalldataBytes = 96_000; // ~96KB across all actions
    }

    /// @notice Accept ETH to fund payable proposal actions.
    receive() external payable {}

    // -------- Views --------

    /// @notice Circulating supply via GenyAllocation.
    function getCirculatingSupply() public view returns (uint256) {
        return IGenyAllocation(allocationManager).getTotalReleasedTokens();
    }

    /// @notice Minimum proposing power for proposal kind (normal/sensitive).
    function getMinProposingPower(bool isSensitive) public view returns (uint256) {
        return (getCirculatingSupply() * (isSensitive ? minProposingPowerSensitivePercent : minProposingPowerNormalPercent)) / 1e4;
    }

    // -------- Governance core --------

    /// @notice Create a new proposal.
    /// @dev Takes snapshot at block.number - 1 to comply with IVotes semantics.
    function createProposal(
        string memory description,
        bool isSensitive,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        uint48 startTime
    ) external whenNotPaused {
        // Snapshot must be a mined block strictly less than current.
        require(block.number > 0, "Snapshot unavailable");
        uint256 snapshotBlock = block.number - 1;

        require(
            token.getPastVotes(msg.sender, snapshotBlock) >= getMinProposingPower(isSensitive),
            "Insufficient proposing power"
        );
        require(targets.length == values.length && values.length == calldatas.length, "Invalid proposal data");
        require(startTime >= block.timestamp, "Start time must be in the future or present");

        uint256 actions = targets.length;
        require(actions <= maxActionsPerProposal, "Too many actions");

        // Validate & sum total calldata size
        uint256 totalBytes;
        for (uint256 i = 0; i < actions; ++i) {
            require(targets[i] != address(0), "Invalid target");
            totalBytes += calldatas[i].length;
        }
        require(totalBytes <= maxTotalCalldataBytes, "Calldata too large");

        proposals[++proposalCount] = Proposal({
            proposer: msg.sender,
            description: description,
            startTime: startTime,
            endTime: startTime + VOTING_PERIOD,
            forVotes: 0,
            againstVotes: 0,
            totalVotes: 0,
            executed: false,
            isSensitive: isSensitive,
            targets: targets,
            values: values,
            calldatas: calldatas,
            snapshotBlock: snapshotBlock
        });

        emit ProposalCreated(
            proposalCount,
            msg.sender,
            investorLabels[msg.sender],
            description,
            isSensitive,
            startTime,
            snapshotBlock
        );
    }

    /// @notice Cast a vote on a proposal.
    function vote(uint256 proposalId, bool support) external nonReentrant whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp >= proposal.startTime && block.timestamp <= proposal.endTime, "Voting not active");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        uint96 weight = uint96(token.getPastVotes(msg.sender, proposal.snapshotBlock));
        require(weight >= minVotingPower, "Insufficient voting power");

        hasVoted[proposalId][msg.sender] = true;
        proposal.totalVotes += weight;
        if (support) proposal.forVotes += weight;
        else proposal.againstVotes += weight;

        emit Voted(proposalId, msg.sender, support, weight);
    }

    /// @notice Execute a successful proposal after the voting window has ended.
    function executeProposal(uint256 proposalId) external onlyOwner nonReentrant whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp > proposal.endTime, "Voting not ended");
        require(!proposal.executed, "Already executed");
        require(proposal.forVotes > proposal.againstVotes, "Proposal rejected");

        uint32 quorumPercent = proposal.isSensitive ? QUORUM_SENSITIVE : QUORUM_NORMAL;
        require(proposal.totalVotes >= (getCirculatingSupply() * quorumPercent) / 1e4, "Quorum not met");

        proposal.executed = true;

        // Execute each call atomically (all-or-nothing).
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            (bool success, ) = proposal.targets[i].call{value: proposal.values[i]}(proposal.calldatas[i]);
            require(success, "Proposal call failed");
        }

        emit ProposalExecuted(proposalId);
    }

    // -------- Admin updates --------

    /// @notice Update proposing power percent (owner).
    function updateMinProposingPowerPercent(bool isSensitive, uint32 newPercent) external onlyOwner {
        require(newPercent >= MIN_PROPOSING_PERCENT_MIN && newPercent <= MIN_PROPOSING_PERCENT_MAX, "Invalid proposing percent");
        if (isSensitive) {
            uint32 oldPercent = minProposingPowerSensitivePercent;
            minProposingPowerSensitivePercent = newPercent;
            emit MinProposingPowerPercentUpdated(true, oldPercent, newPercent);
        } else {
            uint32 oldPercent = minProposingPowerNormalPercent;
            minProposingPowerNormalPercent = newPercent;
            emit MinProposingPowerPercentUpdated(false, oldPercent, newPercent);
        }
    }

    /// @notice Update minimum voting power (owner).
    function updateMinVotingPower(uint256 newPower) external onlyOwner {
        require(newPower >= MIN_VOTING_POWER_MIN && newPower <= MIN_VOTING_POWER_MAX, "Invalid voting power");
        emit MinVotingPowerUpdated(minVotingPower, newPower);
        minVotingPower = newPower;
    }

    /// @notice Update maximum actions per proposal (owner).
    function updateMaxActionsPerProposal(uint16 newMax) external onlyOwner {
        require(newMax > 0 && newMax <= 64, "Invalid max actions");
        emit MaxActionsPerProposalUpdated(maxActionsPerProposal, newMax);
        maxActionsPerProposal = newMax;
    }

    /// @notice Update maximum total calldata bytes per proposal (owner).
    function updateMaxTotalCalldataBytes(uint32 newMaxBytes) external onlyOwner {
        require(newMaxBytes >= 4096 && newMaxBytes <= 200_000, "Invalid calldata cap");
        emit MaxTotalCalldataBytesUpdated(maxTotalCalldataBytes, newMaxBytes);
        maxTotalCalldataBytes = newMaxBytes;
    }

    /// @notice Assign/update investor label (owner).
    function setInvestorLabel(address investor, InvestorLabel label) external onlyOwner {
        _updateInvestorLabel(investor, label);
    }

    /// @notice Burn tokens from treasury (owner).
    function burnTokens(uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be greater than zero");
        require(amount <= (IERC20(address(token)).balanceOf(address(this)) * BURN_MAX_PERCENT) / 1e4, "Exceeds max burn limit");
        require(IERC20(address(token)).balanceOf(address(this)) >= amount, "Insufficient balance");

        IERC20(address(token)).safeTransfer(allocationManager, amount);
        IGenyBurnManager(burnManager).burnFromContract(amount);

        emit TokensBurned(proposalCount, amount);
    }

    // Pause / Upgrade

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // Internals

    function _validateAddresses(address _token, address _owner, address _burnManager, address _allocationManager) private pure {
        require(_token != address(0) && _owner != address(0) && _burnManager != address(0) && _allocationManager != address(0), "Invalid address");
    }

    function _updateInvestorLabel(address investor, InvestorLabel label) private {
        require(investor != address(0), "Invalid investor address");
        emit InvestorLabelUpdated(investor, investorLabels[investor], label);
        investorLabels[investor] = label;
    }

    // Convenience getters
    function getProposalTargets(uint256 proposalId) external view returns (address[] memory) { return proposals[proposalId].targets; }
    function getProposalValues(uint256 proposalId) external view returns (uint256[] memory) { return proposals[proposalId].values; }
    function getProposalCalldatas(uint256 proposalId) external view returns (bytes[] memory) { return proposals[proposalId].calldatas; }

   /// @dev Storage gap for future upgrades (OZ pattern).
   /// If you add new state variables at the end in a future upgrade,
   /// decrease the length of this array by the same number of slots.
   uint256[50] private __gap;
}