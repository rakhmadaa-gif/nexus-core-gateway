// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract VulnVote {
    mapping(uint256 => uint256) public votes;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256 public proposalCount;
    function propose() external returns (uint256) { return ++proposalCount; }
    function vote(uint256 proposalId) external {
        require(!hasVoted[proposalId][msg.sender], "already voted");
        hasVoted[proposalId][msg.sender] = true;
        votes[proposalId] += 1;
    }
}
