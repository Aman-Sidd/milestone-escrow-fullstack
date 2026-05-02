import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  EXPECTED_CHAIN_HEX,
  NATIVE_TOKEN_SYMBOL,
  NETWORK_CONFIG,
} from "../config";

function getMetaMask() {
  return typeof window !== "undefined" ? window.ethereum : null;
}

function shortenError(message) {
  if (!message) {
    return "Something went wrong while connecting the wallet.";
  }

  if (message.includes("User rejected")) {
    return "The wallet request was rejected in MetaMask.";
  }

  return message;
}

function getReadableNetworkName(chainId, networkName) {
  if (chainId === EXPECTED_CHAIN_HEX) {
    return NETWORK_CONFIG.chainName;
  }

  return networkName === "unknown" ? "Unknown network" : networkName;
}

export function useWallet() {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("");
  const [chainId, setChainId] = useState("");
  const [chainName, setChainName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");

  const hasMetaMask = Boolean(getMetaMask());
  const isCorrectNetwork = chainId === EXPECTED_CHAIN_HEX;

  const syncWalletState = useCallback(async (accountsOverride) => {
    const ethereum = getMetaMask();

    if (!ethereum) {
      setAccount("");
      setBalance("");
      setChainId("");
      setChainName("");
      return;
    }

    const provider = new ethers.BrowserProvider(ethereum);
    const accounts =
      accountsOverride ?? (await ethereum.request({ method: "eth_accounts" }));
    const currentChainId = await ethereum.request({ method: "eth_chainId" });
    const network = await provider.getNetwork();

    setChainId(currentChainId);
    setChainName(getReadableNetworkName(currentChainId, network.name));
    setError("");

    if (!accounts.length) {
      setAccount("");
      setBalance("");
      return;
    }

    const selectedAccount = ethers.getAddress(accounts[0]);
    const rawBalance = await provider.getBalance(selectedAccount);

    setAccount(selectedAccount);
    setBalance(Number(ethers.formatEther(rawBalance)).toFixed(4));
  }, []);

  const connectWallet = useCallback(async () => {
    const ethereum = getMetaMask();

    if (!ethereum) {
      setError("MetaMask not detected. Please install MetaMask to continue.");
      return;
    }

    setIsConnecting(true);
    setError("");

    try {
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      await syncWalletState(accounts);
    } catch (err) {
      setError(shortenError(err?.message));
    } finally {
      setIsConnecting(false);
    }
  }, [syncWalletState]);

  const switchNetwork = useCallback(async () => {
    const ethereum = getMetaMask();

    if (!ethereum) {
      setError("MetaMask not detected. Please install MetaMask to continue.");
      return;
    }

    setError("");

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: EXPECTED_CHAIN_HEX }],
      });
      await syncWalletState();
    } catch (switchError) {
      if (switchError?.code === 4902) {
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [NETWORK_CONFIG],
          });
          await syncWalletState();
        } catch (addError) {
          setError(shortenError(addError?.message));
        }
        return;
      }

      setError(shortenError(switchError?.message));
    }
  }, [syncWalletState]);

  useEffect(() => {
    const ethereum = getMetaMask();

    if (!ethereum) {
      return undefined;
    }

    syncWalletState().catch((err) => {
      setError(shortenError(err?.message));
    });

    const handleAccountsChanged = (accounts) => {
      syncWalletState(accounts).catch((err) => {
        setError(shortenError(err?.message));
      });
    };

    const handleChainChanged = () => {
      syncWalletState().catch((err) => {
        setError(shortenError(err?.message));
      });
    };

    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener("accountsChanged", handleAccountsChanged);
      ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [syncWalletState]);

  return {
    account,
    balance,
    chainId,
    chainName,
    isConnecting,
    isCorrectNetwork,
    error,
    hasMetaMask,
    connectWallet,
    switchNetwork,
    nativeTokenSymbol: NATIVE_TOKEN_SYMBOL,
  };
}
