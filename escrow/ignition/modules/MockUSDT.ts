import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MockUSDTModule", (m) => {
  const mockUsdt = m.contract("MockUSDT");
  return { mockUsdt };
});
