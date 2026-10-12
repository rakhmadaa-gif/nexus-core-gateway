// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract InternalCastVote {
    mapping(uint256 => uint256) public votes;
    function tally(uint256 proposalId) external view returns (uint256) {
        return votes[proposalId];
    }
    function castVote(uint256 proposalId) internal {
        votes[proposalId] += 1;
    }
}
