// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TrustFlow
 * @notice Decentralized milestone-based escrow for freelancers and clients.
 *         Supports ETH and USDT payments with arbiter dispute resolution.
 */
contract TrustFlow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────── Types ───────────────────────

    enum TokenType      { ETH, USDT }
    enum EscrowStatus   { Active, Completed, Disputed, Refunded }
    enum MilestoneStatus{ Pending, Submitted, Approved }

    struct Milestone {
        string          title;
        uint256         amount;
        MilestoneStatus status;
    }

    struct Escrow {
        uint256      id;
        address      client;
        address      freelancer;
        address      arbiter;
        TokenType    tokenType;
        uint256      totalAmount;
        uint256      amountReleased;
        EscrowStatus status;
        uint256      deadline;
        Milestone[]  milestones;
    }

    // ─────────────────────── State ───────────────────────

    address public immutable USDT;
    uint256 public escrowCounter;

    mapping(uint256 => Escrow)    private _escrows;
    mapping(address => uint256[]) private _clientEscrows;
    mapping(address => uint256[]) private _freelancerEscrows;
    mapping(address => uint256[]) private _arbiterEscrows;

    // ─────────────────────── Events ──────────────────────

    event EscrowCreated(
        uint256 indexed id,
        address indexed client,
        address indexed freelancer,
        address arbiter,
        uint8   tokenType,
        uint256 totalAmount,
        uint256 deadline
    );
    event MilestoneSubmitted(uint256 indexed escrowId, uint256 milestoneIndex);
    event MilestoneApproved(uint256 indexed escrowId, uint256 milestoneIndex, uint256 amount);
    event DisputeRaised(uint256 indexed escrowId, address raisedBy);
    event DisputeResolved(uint256 indexed escrowId, address arbiter, bool freelancerWins, uint256 amount);
    event Refunded(uint256 indexed escrowId, address client, uint256 amount);

    // ─────────────────────── Constructor ─────────────────

    constructor(address _usdt) {
        require(_usdt != address(0), "Invalid USDT address");
        USDT = _usdt;
    }

    // ─────────────────────── External ────────────────────

    /// @notice Create escrow funded with ETH.
    function createEscrowETH(
        address freelancer,
        address arbiter,
        string[] calldata titles,
        uint256[] calldata amounts,
        uint256 deadline
    ) external payable nonReentrant {
        uint256 total = _validate(freelancer, arbiter, titles, amounts, deadline);
        require(msg.value == total, "ETH value != milestone sum");
        _createEscrow(msg.sender, freelancer, arbiter, TokenType.ETH, titles, amounts, total, deadline);
    }

    /// @notice Create escrow funded with USDT (caller must approve first).
    function createEscrowUSDT(
        address freelancer,
        address arbiter,
        string[] calldata titles,
        uint256[] calldata amounts,
        uint256 deadline
    ) external nonReentrant {
        uint256 total = _validate(freelancer, arbiter, titles, amounts, deadline);
        IERC20(USDT).safeTransferFrom(msg.sender, address(this), total);
        _createEscrow(msg.sender, freelancer, arbiter, TokenType.USDT, titles, amounts, total, deadline);
    }

    /// @notice Freelancer marks a milestone ready for review.
    function submitMilestone(uint256 escrowId, uint256 milestoneIndex) external {
        Escrow storage e = _activeEscrow(escrowId);
        require(msg.sender == e.freelancer, "Only freelancer");
        require(milestoneIndex < e.milestones.length, "Bad index");
        require(e.milestones[milestoneIndex].status == MilestoneStatus.Pending, "Not pending");

        e.milestones[milestoneIndex].status = MilestoneStatus.Submitted;
        emit MilestoneSubmitted(escrowId, milestoneIndex);
    }

    /// @notice Client approves a submitted milestone and releases its funds.
    function approveMilestone(uint256 escrowId, uint256 milestoneIndex) external nonReentrant {
        Escrow storage e = _activeEscrow(escrowId);
        require(msg.sender == e.client, "Only client");
        require(milestoneIndex < e.milestones.length, "Bad index");
        require(e.milestones[milestoneIndex].status == MilestoneStatus.Submitted, "Not submitted");

        Milestone storage m = e.milestones[milestoneIndex];
        m.status = MilestoneStatus.Approved;
        e.amountReleased += m.amount;

        if (e.amountReleased == e.totalAmount) {
            e.status = EscrowStatus.Completed;
        }

        _transfer(e.tokenType, e.freelancer, m.amount);
        emit MilestoneApproved(escrowId, milestoneIndex, m.amount);
    }

    /// @notice Client or freelancer raises a dispute, freezing the escrow.
    function raiseDispute(uint256 escrowId) external {
        Escrow storage e = _activeEscrow(escrowId);
        require(msg.sender == e.client || msg.sender == e.freelancer, "Not a party");
        e.status = EscrowStatus.Disputed;
        emit DisputeRaised(escrowId, msg.sender);
    }

    /// @notice Arbiter resolves a dispute: sends remaining funds to winner.
    function resolveDispute(uint256 escrowId, bool freelancerWins) external nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.client != address(0), "Not found");
        require(msg.sender == e.arbiter, "Only arbiter");
        require(e.status == EscrowStatus.Disputed, "Not disputed");

        uint256 remaining = e.totalAmount - e.amountReleased;
        e.status = EscrowStatus.Refunded;

        address winner = freelancerWins ? e.freelancer : e.client;
        _transfer(e.tokenType, winner, remaining);
        emit DisputeResolved(escrowId, msg.sender, freelancerWins, remaining);
    }

    /// @notice Client reclaims unreleased funds after deadline passes.
    function refund(uint256 escrowId) external nonReentrant {
        Escrow storage e = _activeEscrow(escrowId);
        require(msg.sender == e.client, "Only client");
        require(block.timestamp > e.deadline, "Deadline not passed");

        uint256 remaining = e.totalAmount - e.amountReleased;
        require(remaining > 0, "Nothing to refund");
        e.status = EscrowStatus.Refunded;

        _transfer(e.tokenType, e.client, remaining);
        emit Refunded(escrowId, e.client, remaining);
    }

    // ─────────────────────── Views ───────────────────────

    function getEscrow(uint256 escrowId) external view returns (
        address client, address freelancer, address arbiter,
        uint8 tokenType, uint256 totalAmount, uint256 amountReleased,
        uint8 status, uint256 deadline
    ) {
        Escrow storage e = _escrows[escrowId];
        return (
            e.client, e.freelancer, e.arbiter,
            uint8(e.tokenType), e.totalAmount, e.amountReleased,
            uint8(e.status), e.deadline
        );
    }

    function getMilestones(uint256 escrowId) external view returns (Milestone[] memory) {
        return _escrows[escrowId].milestones;
    }

    function getClientEscrows(address client) external view returns (uint256[] memory) {
        return _clientEscrows[client];
    }

    function getFreelancerEscrows(address freelancer) external view returns (uint256[] memory) {
        return _freelancerEscrows[freelancer];
    }

    function getArbiterEscrows(address arbiter) external view returns (uint256[] memory) {
        return _arbiterEscrows[arbiter];
    }

    // ─────────────────────── Internal ────────────────────

    function _validate(
        address freelancer, address arbiter,
        string[] calldata titles, uint256[] calldata amounts,
        uint256 deadline
    ) internal view returns (uint256 total) {
        require(freelancer != address(0) && arbiter != address(0), "Zero address");
        require(msg.sender != freelancer, "Client = freelancer");
        require(freelancer != arbiter, "Freelancer = arbiter");
        require(titles.length == amounts.length, "Length mismatch");
        require(titles.length >= 1 && titles.length <= 10, "1-10 milestones");
        require(deadline > block.timestamp, "Deadline in past");
        for (uint256 i; i < amounts.length; i++) {
            require(amounts[i] > 0, "Zero amount");
            total += amounts[i];
        }
    }

    function _createEscrow(
        address client, address freelancer, address arbiter,
        TokenType tokenType,
        string[] calldata titles, uint256[] calldata amounts,
        uint256 total, uint256 deadline
    ) internal {
        uint256 id = escrowCounter++;
        Escrow storage e = _escrows[id];
        e.id           = id;
        e.client       = client;
        e.freelancer   = freelancer;
        e.arbiter      = arbiter;
        e.tokenType    = tokenType;
        e.totalAmount  = total;
        e.status       = EscrowStatus.Active;
        e.deadline     = deadline;

        for (uint256 i; i < titles.length; i++) {
            e.milestones.push(Milestone({ title: titles[i], amount: amounts[i], status: MilestoneStatus.Pending }));
        }

        _clientEscrows[client].push(id);
        _freelancerEscrows[freelancer].push(id);
        _arbiterEscrows[arbiter].push(id);

        emit EscrowCreated(id, client, freelancer, arbiter, uint8(tokenType), total, deadline);
    }

    function _activeEscrow(uint256 escrowId) internal view returns (Escrow storage e) {
        e = _escrows[escrowId];
        require(e.client != address(0), "Not found");
        require(e.status == EscrowStatus.Active, "Not active");
    }

    function _transfer(TokenType tokenType, address to, uint256 amount) internal {
        if (tokenType == TokenType.ETH) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(USDT).safeTransfer(to, amount);
        }
    }
}
