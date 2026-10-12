// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract CounterBoundsVote {
    uint256 public proposalCount;
    mapping(uint256 => uint256) public votes;
    function vote(uint256 proposalId) external {
        require(proposalCount >= proposalId && proposalId > 0, "invalid proposal id");
        votes[proposalId] += 1;
    }
}
