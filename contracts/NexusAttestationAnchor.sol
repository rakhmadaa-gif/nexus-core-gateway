// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NexusAttestationAnchor
/// @notice Immutable timestamp anchor for Nexus Fitness attestation Merkle roots.
///         The Nexus agent (ERC-8004 #636, owner) anchors one Merkle root per
///         attestation batch (normally one per UTC day). Anyone can verify that
///         a signed attestation existed no later than the anchor timestamp by
///         recomputing its EIP-712 struct hash and checking the Merkle proof
///         against a root stored here.
contract NexusAttestationAnchor {
    address public immutable owner;

    /// @notice root => block.timestamp when it was anchored (0 = not anchored)
    mapping(bytes32 => uint256) public anchoredAt;

    /// @notice day as YYYYMMDD (e.g. 20261010) for off-chain indexing
    event Anchored(bytes32 indexed root, uint64 indexed day, uint32 count);

    error NotOwner();
    error AlreadyAnchored();
    error EmptyRoot();

    constructor() {
        owner = msg.sender;
    }

    /// @param root  Merkle root over EIP-712 struct hashes of the batch's attestations
    /// @param day   UTC day as YYYYMMDD the batch belongs to
    /// @param count Number of attestations (leaves) in the batch
    function anchor(bytes32 root, uint64 day, uint32 count) external {
        if (msg.sender != owner) revert NotOwner();
        if (root == bytes32(0)) revert EmptyRoot();
        if (anchoredAt[root] != 0) revert AlreadyAnchored();
        anchoredAt[root] = block.timestamp;
        emit Anchored(root, day, count);
    }
}
