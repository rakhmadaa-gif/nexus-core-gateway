// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract VoteNoProposalId {
    uint256 public tally;
    function vote(bool support) external {
        if (support) tally += 1;
    }
}
