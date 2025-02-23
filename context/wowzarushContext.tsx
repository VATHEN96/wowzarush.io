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
} from "@/utils/contextInterfaces";
import { contractABI, contractAddress } from "@/utils/constants";

const defaultContextValue: wowzarushContextType = {
    isConnected: false,
    connectedAccount: null,
    accountBalance: 0,
    campaigns: [],
    userCampaigns: [],
    loading: false,
    error: null,
    createCampaign: async () => { },
    contributeToCampaign: async () => { },
    withdrawFromCampaign: async () => { },
    completeMilestone: async () => { },
    updateMilestone: async () => { },
    connectWallet: async () => { },
    disconnectWallet: async () => Promise.resolve(),
    fetchCampaigns: async () => [],
    getCampaignById: async () => null,
    getCampaign: () => undefined,
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

    // Helper function to get provider and signer
    const getProviderAndSigner = useCallback(async () => {
        if (typeof window === "undefined" || !window.ethereum) {
            throw new Error("No Ethereum provider found. Please install MetaMask.");
        }

        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await window.ethereum.request({ method: "eth_requestAccounts" });
        const signer = provider.getSigner();
        return { provider, signer };
    }, []);

    // Helper function to get contract instance
    const getContract = useCallback(async () => {
        const { signer } = await getProviderAndSigner();
        return new ethers.Contract(contractAddress, contractABI, signer);
    }, [getProviderAndSigner]);

    const connectWallet = useCallback(async () => {
        try {
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

            // Fetch user's campaigns after connecting
            await fetchCampaigns();
        } catch (error: any) {
            setError(error.message || "Failed to connect wallet");
            setIsConnected(false);
            setConnectedAccount(null);
            setAccountBalance(0);
        }
    }, []);

    const disconnectWallet = useCallback(async (): Promise<void> => {
        setConnectedAccount(null);
        setIsConnected(false);
        setAccountBalance(0);
        setCampaigns([]);
        setUserCampaigns([]);
        return Promise.resolve();
    }, []);

    const checkNetwork = useCallback(async () => {
        try {
            const { provider } = await getProviderAndSigner();
            const network = await provider.getNetwork();
            const expectedChainId = "0x1";

            if (network.chainId !== parseInt(expectedChainId, 16)) {
                await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: expectedChainId }],
                });
            }
        } catch (error: any) {
            throw new Error("Failed to switch network: " + error.message);
        }
    }, [getProviderAndSigner]);

    const fetchCampaigns = useCallback(async (): Promise<Campaign[]> => {
        setLoading(true);
        setError(null);

        try {
            const contract = await getContract();
            await checkNetwork();

            const campaignCounter = await contract.campaignCounter();

            if (Number(campaignCounter) === 0) {
                setCampaigns([]);
                return [];
            }

            const campaignPromises = Array.from(
                { length: Number(campaignCounter) },
                (_, i) => contract.getCampaignMetadata(i)
            );

            const rawCampaigns = await Promise.all(campaignPromises);
            const parsedCampaigns = rawCampaigns.map((campaign: any) => ({
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
                    dueDate: ms.dueDate
                        ? new Date(ms.dueDate.toNumber() * 1000)
                        : undefined,
                })) || [],
                category: campaign.category,
                beneficiaries: campaign.beneficiaries,
                proofOfWork: campaign.proofOfWork,
                collateral: campaign.collateral,
                multimedia: campaign.multimedia,
                isActive: campaign.isActive,
                createdAt: new Date(campaign.createdAt.toNumber() * 1000),
                duration: Number(campaign.duration),
            }));

            setCampaigns(parsedCampaigns);
            return parsedCampaigns;
        } catch (err: any) {
            const errorMessage = err.reason || err.message || "Failed to fetch campaigns";
            setError(errorMessage);
            return [];
        } finally {
            setLoading(false);
        }
    }, [checkNetwork, getContract]);

    // Event Listeners for account changes
    useEffect(() => {
        if (typeof window !== "undefined" && window.ethereum) {
            const handleAccountsChanged = (accounts: string[]) => {
                if (accounts.length === 0) {
                    disconnectWallet();
                } else if (accounts[0] !== connectedAccount) {
                    setConnectedAccount(accounts[0]);
                }
            };

            window.ethereum?.on?.("accountsChanged", handleAccountsChanged);
            window.ethereum?.on?.("chainChanged", () => window.location.reload());

            return () => {
                window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
                window.ethereum?.removeListener?.("chainChanged", () => window.location.reload());
            };
        }
    }, [connectedAccount, disconnectWallet]);

    return (
        <WowzarushContext.Provider
            value={{
                isConnected,
                connectedAccount,
                accountBalance,
                campaigns,
                userCampaigns,
                loading,
                error,
                connectWallet,
                disconnectWallet,
                fetchCampaigns,
            }}
        >
            {children}
        </WowzarushContext.Provider>
    );
};

export const useWowzarush = () => useContext(WowzarushContext);
