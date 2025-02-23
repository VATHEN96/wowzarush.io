﻿"use client";

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useEffect,
} from "react";
import { ethers } from "ethers";
import type {
  Campaign,
  Milestone,
  wowzarushContextType,
} from "@/utils/types";
import { contractABI, contractAddress } from "@/utils/constants";

const defaultContextValue: wowzarushContextType = {
  isConnected: false,
  connectedAccount: null,
  accountBalance: 0,
  campaigns: [],
  userCampaigns: [],
  loading: false,
  error: null,
  createCampaign: async () => {},
  contributeToCampaign: async () => {},
  withdrawFromCampaign: async () => {},
  completeMilestone: async () => {},
  updateMilestone: async () => {},
  connectWallet: async () => {},
  disconnectWallet: async () => Promise.resolve(),
  fetchCampaigns: async () => [],
  getCampaignById: async (id: string): Promise<Campaign | null> => null,
  getCampaign: (id: string) => undefined,
  getUserContributions: async () => [],
};

const WowzarushContext = createContext<wowzarushContextType>(defaultContextValue);

export const WowzarushProvider = ({ children }: { children: ReactNode }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);
  const [accountBalance, setAccountBalance] = useState<number>(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [userCampaigns, setUserCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Helper: Get provider and signer
  const getProviderAndSigner = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error("No Ethereum provider found. Please install MetaMask.");
    }
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await window.ethereum.request({ method: "eth_requestAccounts" });
    const signer = provider.getSigner();
    return { provider, signer };
  }, []);

  // Helper: Get contract instance
  const getContract = useCallback(async () => {
    const { signer } = await getProviderAndSigner();
    return new ethers.Contract(contractAddress, contractABI, signer);
  }, [getProviderAndSigner]);

  // Helper: Parse campaign data from blockchain format
  const parseCampaign = useCallback((campaign: any): Campaign => ({
    id: campaign.id.toString(),
    creator: campaign.creator,
    title: campaign.title,
    description: campaign.description,
    goalAmount: Number(ethers.utils.formatEther(campaign.goalAmount)),
    totalFunded: Number(ethers.utils.formatEther(campaign.totalFunded)),
    deadline: new Date(campaign.deadline.toNumber() * 1000),
    milestones: campaign.milestones?.map((ms: any, index: number): Milestone => ({
      id: ms.id?.toString() || `milestone-${index}`,
      name: ms.name,
      target: Number(ethers.utils.formatEther(ms.target)),
      completed: ms.completed,
      dueDate: ms.dueDate ? new Date(ms.dueDate.toNumber() * 1000) : undefined,
    })) || [],
    category: campaign.category,
    beneficiaries: campaign.beneficiaries,
    proofOfWork: campaign.proofOfWork,
    collateral: campaign.collateral,
    multimedia: campaign.multimedia,
    isActive: campaign.isActive,
    createdAt: new Date(campaign.createdAt.toNumber() * 1000),
    duration: Number(campaign.duration),
  }), []);

  const fetchCampaigns = useCallback(async (): Promise<Campaign[]> => {
    try {
      setLoading(true);
      setError(null);
      const contract = await getContract();
      const campaignData = await contract.getCampaigns();
      const parsedCampaigns = campaignData.map(parseCampaign);
      setCampaigns(parsedCampaigns);
      return parsedCampaigns;
    } catch (error: any) {
      setError(error.message || "Failed to fetch campaigns");
      return [];
    } finally {
      setLoading(false);
    }
  }, [getContract, parseCampaign]);

  const connectWallet = useCallback(async () => {
    try {
      setError(null);
      const { provider } = await getProviderAndSigner();
      const accounts = await provider.listAccounts();
      if (accounts.length === 0) {
        throw new Error("No accounts found. Please connect your wallet.");
      }
      const account = accounts[0];
      setConnectedAccount(account);
      setIsConnected(true);
      const balance = await provider.getBalance(account);
      setAccountBalance(Number(ethers.utils.formatEther(balance)));
      const camps = await fetchCampaigns();
      if (account) {
        const userCamps = camps.filter(
          (camp) => camp.creator.toLowerCase() === account.toLowerCase()
        );
        setUserCampaigns(userCamps);
      }
    } catch (error: any) {
      setError(error.message || "Failed to connect wallet");
      setIsConnected(false);
      setConnectedAccount(null);
      setAccountBalance(0);
    }
  }, [fetchCampaigns, getProviderAndSigner]);

  const disconnectWallet = useCallback(async (): Promise<void> => {
    setConnectedAccount(null);
    setIsConnected(false);
    setAccountBalance(0);
    setCampaigns([]);
    setUserCampaigns([]);
    setError(null);
    return Promise.resolve();
  }, []);

  // Initialize wallet connection and fetch campaigns
  useEffect(() => {
    const initializeWallet = async () => {
      try {
        const { provider, signer } = await getProviderAndSigner();
        if (signer) {
          const address = await signer.getAddress();
          setConnectedAccount(address);
          setIsConnected(true);
          const balance = await provider.getBalance(address);
          setAccountBalance(Number(ethers.utils.formatEther(balance)));
          await fetchCampaigns();
        }
      } catch (error) {
        console.error("Error initializing wallet:", error);
        setConnectedAccount(null);
        setAccountBalance(0);
      }
    };

    if (typeof window !== "undefined" && window.ethereum) {
      initializeWallet();
    }
  }, [fetchCampaigns, getProviderAndSigner]);

  // Listen for account and chain changes
  useEffect(() => {
    if (typeof window !== "undefined" && window.ethereum) {
      const eth = window.ethereum as any;
      const handleAccountsChanged = async (accounts: string[]) => {
        if (accounts.length === 0) {
          await disconnectWallet();
        } else if (accounts[0] !== connectedAccount) {
          await connectWallet();
        }
      };
      eth?.on("accountsChanged", handleAccountsChanged);
      eth?.on("chainChanged", () => window.location.reload());
      return () => {
        eth?.removeListener("accountsChanged", handleAccountsChanged);
        eth?.removeListener("chainChanged", () => window.location.reload());
      };
    }
  }, [connectedAccount, connectWallet, disconnectWallet]);

  const getCampaignById = useCallback(async (id: string): Promise<Campaign | null> => {
    try {
      setLoading(true);
      setError(null);
      const contract = await getContract();
      const campaignData = await contract.getCampaign(id);
      if (!campaignData) return null;
      return parseCampaign(campaignData);
    } catch (error: any) {
      setError(error.message || "Failed to fetch campaign");
      return null;
    } finally {
      setLoading(false);
    }
  }, [getContract, parseCampaign]);

  const getCampaign = useCallback((id: string): Campaign | undefined => {
    return campaigns.find(campaign => campaign.id === id);
  }, [campaigns]);

  const contextValue: wowzarushContextType = {
    isConnected,
    connectedAccount,
    accountBalance,
    campaigns,
    userCampaigns,
    loading,
    error,
    createCampaign: async () => {},
    contributeToCampaign: async () => {},
    withdrawFromCampaign: async () => {},
    completeMilestone: async () => {},
    updateMilestone: async () => {},
    connectWallet,
    disconnectWallet,
    fetchCampaigns,
    getCampaignById,
    getCampaign,
    getUserContributions: async () => [],
  };

  return (
    <WowzarushContext.Provider value={contextValue}>
      {children}
    </WowzarushContext.Provider>
  );
};

export const useWowzarush = () => {
  const context = useContext(WowzarushContext);
  if (!context) {
    throw new Error("useWowzarush must be used within a WowzarushProvider");
  }
  return context;
};
