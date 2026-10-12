// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract OZGovernorStyle {
    struct Proposal { uint256 voteStart; uint256 voteEnd; }
    mapping(uint256 => Proposal) private _proposals;
    error GovernorNonexistentProposal(uint256 proposalId);
    function state(uint256 proposalId) public view returns (uint256) {
        uint256 snapshot = _proposals[proposalId].voteStart;
        if (snapshot == 0) revert GovernorNonexistentProposal(proposalId);
        return 1;
    }
    function _castVote(uint256 proposalId, address voter, uint8 support) internal returns (uint256) {
        state(proposalId);
        _proposals[proposalId].voteEnd += 0;
        return 1;
    }
    function castVote(uint256 proposalId, uint8 support) public returns (uint256) {
        return _castVote(proposalId, msg.sender, support);
    }
}
