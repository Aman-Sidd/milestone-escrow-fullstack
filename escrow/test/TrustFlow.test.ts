import { expect } from "chai";
import hre from "hardhat";

const ONE_DAY = 24 * 60 * 60;

const { ethers } = await hre.network.connect();

async function getDeadline(offsetSeconds = ONE_DAY) {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp + offsetSeconds;
}

describe("TrustFlow", function () {
  let trustflow: any;
  let usdt: any;
  let deployer: any, client: any, freelancer: any, arbiter: any, other: any;

  const TITLES = ["Wireframes", "Frontend", "Final Delivery"];
  const ETH_AMTS = [
    ethers.parseEther("0.05"),
    ethers.parseEther("0.10"),
    ethers.parseEther("0.05"),
  ];
  const USDT_AMTS = [
    ethers.parseUnits("50", 6),
    ethers.parseUnits("100", 6),
    ethers.parseUnits("50", 6),
  ];
  const ETH_TOTAL = ETH_AMTS.reduce((a, b) => a + b, 0n);
  const USDT_TOTAL = USDT_AMTS.reduce((a, b) => a + b, 0n);

  beforeEach(async () => {
    [deployer, client, freelancer, arbiter, other] = await ethers.getSigners();

    usdt = await ethers.deployContract("MockUSDT");
    trustflow = await ethers.deployContract("TrustFlow", [await usdt.getAddress()]);

    // Fund client with USDT
    await usdt.transfer(client.address, ethers.parseUnits("10000", 6));
  });

  // ─── Deployment ────────────────────────────────────────
  describe("Deployment", () => {
    it("stores USDT address", async () => {
      expect(await trustflow.USDT()).to.equal(await usdt.getAddress());
    });
    it("starts with escrowCounter = 0", async () => {
      expect(await trustflow.escrowCounter()).to.equal(0n);
    });
  });

  // ─── ETH Escrow ────────────────────────────────────────
  describe("createEscrowETH", () => {
    it("creates an escrow and stores milestones", async () => {
      const deadline = await getDeadline();
      await trustflow.connect(client).createEscrowETH(
        freelancer.address, arbiter.address, TITLES, ETH_AMTS, deadline,
        { value: ETH_TOTAL }
      );
      expect(await trustflow.escrowCounter()).to.equal(1n);
      const [cl, fl, arb, , total, , status] = await trustflow.getEscrow(0);
      expect(cl).to.equal(client.address);
      expect(fl).to.equal(freelancer.address);
      expect(arb).to.equal(arbiter.address);
      expect(total).to.equal(ETH_TOTAL);
      expect(status).to.equal(0); // Active
    });

    it("reverts if ETH value != sum", async () => {
      const deadline = await getDeadline();
      await expect(
        trustflow.connect(client).createEscrowETH(
          freelancer.address, arbiter.address, TITLES, ETH_AMTS, deadline,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("ETH value != milestone sum");
    });

    it("reverts if deadline in past", async () => {
      const past = Math.floor(Date.now() / 1000) - 1;
      await expect(
        trustflow.connect(client).createEscrowETH(
          freelancer.address, arbiter.address, TITLES, ETH_AMTS, past,
          { value: ETH_TOTAL }
        )
      ).to.be.revertedWith("Deadline in past");
    });
  });

  // ─── USDT Escrow ───────────────────────────────────────
  describe("createEscrowUSDT", () => {
    it("pulls USDT from caller and creates escrow", async () => {
      const deadline = await getDeadline();
      await usdt.connect(client).approve(await trustflow.getAddress(), USDT_TOTAL);
      await trustflow.connect(client).createEscrowUSDT(
        freelancer.address, arbiter.address, TITLES, USDT_AMTS, deadline
      );
      const [, , , tokenType, total] = await trustflow.getEscrow(0);
      expect(tokenType).to.equal(1); // USDT
      expect(total).to.equal(USDT_TOTAL);
    });
  });

  // ─── Milestone Flow ────────────────────────────────────
  describe("Happy path: submit → approve (ETH)", () => {
    let escrowId: number;

    beforeEach(async () => {
      const deadline = await getDeadline();
      await trustflow.connect(client).createEscrowETH(
        freelancer.address, arbiter.address, TITLES, ETH_AMTS, deadline,
        { value: ETH_TOTAL }
      );
      escrowId = 0;
    });

    it("freelancer submits milestone 0", async () => {
      await expect(
        trustflow.connect(freelancer).submitMilestone(escrowId, 0)
      ).to.emit(trustflow, "MilestoneSubmitted").withArgs(escrowId, 0);

      const milestones = await trustflow.getMilestones(escrowId);
      expect(milestones[0].status).to.equal(1); // Submitted
    });

    it("client approves milestone 0 and freelancer receives ETH", async () => {
      await trustflow.connect(freelancer).submitMilestone(escrowId, 0);

      const before = await ethers.provider.getBalance(freelancer.address);
      await expect(
        trustflow.connect(client).approveMilestone(escrowId, 0)
      ).to.emit(trustflow, "MilestoneApproved").withArgs(escrowId, 0, ETH_AMTS[0]);

      const after = await ethers.provider.getBalance(freelancer.address);
      expect(after - before).to.equal(ETH_AMTS[0]);
    });

    it("escrow status becomes Completed when all milestones approved", async () => {
      for (let i = 0; i < TITLES.length; i++) {
        await trustflow.connect(freelancer).submitMilestone(escrowId, i);
        await trustflow.connect(client).approveMilestone(escrowId, i);
      }
      const [, , , , , , status] = await trustflow.getEscrow(escrowId);
      expect(status).to.equal(1); // Completed
    });
  });

  // ─── Access Control ────────────────────────────────────
  describe("Access control", () => {
    beforeEach(async () => {
      const deadline = await getDeadline();
      await trustflow.connect(client).createEscrowETH(
        freelancer.address, arbiter.address, TITLES, ETH_AMTS, deadline,
        { value: ETH_TOTAL }
      );
    });

    it("client cannot submit milestone", async () => {
      await expect(
        trustflow.connect(client).submitMilestone(0, 0)
      ).to.be.revertedWith("Only freelancer");
    });

    it("freelancer cannot approve milestone", async () => {
      await trustflow.connect(freelancer).submitMilestone(0, 0);
      await expect(
        trustflow.connect(freelancer).approveMilestone(0, 0)
      ).to.be.revertedWith("Only client");
    });

    it("cannot approve without prior submission", async () => {
      await expect(
        trustflow.connect(client).approveMilestone(0, 0)
      ).to.be.revertedWith("Not submitted");
    });
  });

  // ─── Dispute ───────────────────────────────────────────
  describe("Dispute & resolution", () => {
    beforeEach(async () => {
      const deadline = await getDeadline();
      await trustflow.connect(client).createEscrowETH(
        freelancer.address, arbiter.address, TITLES, ETH_AMTS, deadline,
        { value: ETH_TOTAL }
      );
    });

    it("client raises dispute", async () => {
      await expect(
        trustflow.connect(client).raiseDispute(0)
      ).to.emit(trustflow, "DisputeRaised").withArgs(0, client.address);
      const [, , , , , , status] = await trustflow.getEscrow(0);
      expect(status).to.equal(2); // Disputed
    });

    it("arbiter resolves: freelancer wins", async () => {
      await trustflow.connect(client).raiseDispute(0);
      const before = await ethers.provider.getBalance(freelancer.address);
      await trustflow.connect(arbiter).resolveDispute(0, true);
      const after = await ethers.provider.getBalance(freelancer.address);
      expect(after - before).to.equal(ETH_TOTAL);
    });

    it("arbiter resolves: client wins (refund)", async () => {
      await trustflow.connect(client).raiseDispute(0);

      // approve 1 milestone first so partial release already happened
      // (can't, escrow is already disputed - test full refund)
      const before = await ethers.provider.getBalance(client.address);
      await trustflow.connect(arbiter).resolveDispute(0, false);
      const after = await ethers.provider.getBalance(client.address);
      // arbiter pays the gas, so client's balance increases by exactly ETH_TOTAL
      expect(after - before).to.equal(ETH_TOTAL);
    });

    it("non-arbiter cannot resolve", async () => {
      await trustflow.connect(client).raiseDispute(0);
      await expect(
        trustflow.connect(other).resolveDispute(0, true)
      ).to.be.revertedWith("Only arbiter");
    });
  });

  // ─── Refund after deadline ─────────────────────────────
  describe("Refund after deadline", () => {
    it("client reclaims funds after deadline", async () => {
      const deadline = await getDeadline(10); // 10 seconds
      await trustflow.connect(client).createEscrowETH(
        freelancer.address, arbiter.address, TITLES, ETH_AMTS, deadline,
        { value: ETH_TOTAL }
      );

      // Fast-forward time
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        trustflow.connect(client).refund(0)
      ).to.emit(trustflow, "Refunded");
    });

    it("reverts if deadline not passed", async () => {
      const deadline = await getDeadline(ONE_DAY);
      await trustflow.connect(client).createEscrowETH(
        freelancer.address, arbiter.address, TITLES, ETH_AMTS, deadline,
        { value: ETH_TOTAL }
      );
      await expect(
        trustflow.connect(client).refund(0)
      ).to.be.revertedWith("Deadline not passed");
    });
  });
});
