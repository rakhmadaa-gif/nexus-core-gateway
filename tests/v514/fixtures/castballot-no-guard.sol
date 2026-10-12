// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract CastBallotNoGuard {
    mapping(uint256 => uint256) public votes;
    function castBallot(uint256 proposalId) external {
        votes[proposalId] += 1;
    }
}
