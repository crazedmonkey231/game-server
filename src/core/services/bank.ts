import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import { makeId } from "../../utils";
import { Account, Service } from "../../types";
import { serverState } from "../serverstate";

export const currency: Record<string, string> = {
  credits: "Credits", // Universal currency for all transactions
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

export type Currency = keyof typeof currency;

export const stock: Record<string, string> = {
  SPO: "Space Ore",
  ATC: "Alien Tech",
  RG: "Rare Gem",
};

export type StockItem = keyof typeof stock;

export type PortfolioItem = Currency | StockItem;

export const exchangeRates: Record<Currency, number> = {
  credits: 1, // Base currency
  bronze: 0.01,
  silver: 0.1,
  gold: 1,
  platinum: 10,
  diamond: 100,
  SPO: 5, 
  ATC: 20,
  RG: 50,
};

export interface PortfolioEntry {
  item: PortfolioItem;
  quantity: number;
}

export interface Portfolio {
  entries: Record<PortfolioItem, PortfolioEntry>;
  totalValue: number;
}

export interface BankAccount {
  id: string;
  ownerId: string;
  portfolio: Portfolio;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  item: PortfolioItem;
  quantity: number;
  pricePerUnit: number;
  totalPrice: number;
  timestamp: Date;
  status: "pending" | "completed" | "failed";
}

export function convertCurrency(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  const amountInCredits = amount * exchangeRates[from];
  return amountInCredits / exchangeRates[to];
}

export function calculateTotalPrice(quantity: number, pricePerUnit: number): number {
  return quantity * pricePerUnit;
}

function calculateTotalValue(portfolio: Portfolio): number {
  let total = 0;
  for (const entry of Object.values(portfolio.entries)) {
    if (currency[entry.item as Currency]) {
      total += entry.quantity * exchangeRates[entry.item as Currency];
    } else {
      // For stock items, we can assign a fixed value or implement a dynamic pricing mechanism
      total += entry.quantity * 50; // Placeholder value for stock items
    }
  }
  return total;
}

/** This file defines the BankingService which manages bank accounts, portfolios, and transactions for player profiles. */
export class BankingService implements Service {
  name = "Bank";
  private accounts: Record<string, BankAccount> = {};
  private transactionHistory: Transaction[] = [];
  private io?: IOServer;

  constructor() {
    // Initialize with default bank account that holds the initial stock and currency for the game
    this.accounts["Bank"] = {
      id: "Bank",
      ownerId: "Bank",
      portfolio: this.defaultBankPortfolio(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }  
  
  registerRoutes(app: Application, io: IOServer): void {
    this.io = io;
    app.get("/api/bank/:accountId", this.apiGetAccountRequest.bind(this));
    app.get("/api/bank/:accountId/portfolio", this.apiPortfolioRequest.bind(this));
    app.post("/api/bank/transaction", this.apiTransactionRequest.bind(this));
    app.post("/api/bank/createAccount", this.apiCreateAccountRequest.bind(this));
    app.delete("/api/bank/deleteAccount/:accountId", this.apiDeleteAccountRequest.bind(this));
  }

  private defaultBankPortfolio(): Portfolio {
    const bankPortfolio: Portfolio = {
      entries: {
        credits: { item: "credits", quantity: 1000000 },
        bronze: { item: "bronze", quantity: 1000 },
        silver: { item: "silver", quantity: 500 },
        gold: { item: "gold", quantity: 200 },
        platinum: { item: "platinum", quantity: 100 },
        diamond: { item: "diamond", quantity: 50 },
        SPO: { item: "SPO", quantity: 100 },
        ATC: { item: "ATC", quantity: 50 },
        RG: { item: "RG", quantity: 20 },
      },
      totalValue: 0,
    };
    bankPortfolio.totalValue = calculateTotalValue(bankPortfolio);
    return bankPortfolio;
  }

  createAccount(profile: Account): boolean {
    if (profile.bankAccountId) {
      return false; // Profile already has a bank account
    }
    const accountId = makeId(12);
    const newAccount: BankAccount = {
      id: accountId,
      ownerId: profile.id,
      portfolio: { entries: {

      }, totalValue: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.accounts[accountId] = newAccount;
    profile.bankAccountId = accountId;
    return true;
  }

  deleteAccount(accountId: string): boolean {
    if (this.accounts[accountId]) {
      const account = this.accounts[accountId];
      const bankAccount = this.accounts["Bank"];
      // Before deleting, return all assets to the bank account
      for (const entry of Object.values(account.portfolio.entries)) {
        const bankEntry = bankAccount.portfolio.entries[entry.item] || {
          item: entry.item,
          quantity: 0,
        };
        bankEntry.quantity += entry.quantity;
        bankAccount.portfolio.entries[entry.item] = bankEntry;
      }
      bankAccount.portfolio.totalValue = calculateTotalValue(bankAccount.portfolio);
      delete this.accounts[accountId];
      return true;
    }
    return false;
  }

  getAccount(accountId: string): BankAccount | null {
    return this.accounts[accountId] || null;
  }

  createTransaction(fromAccountId: string, toAccountId: string, item: PortfolioItem, quantity: number): Transaction {
    const canCreate = (!this.accounts[fromAccountId] || !this.accounts[toAccountId])
      || quantity <= 0
      || (!exchangeRates[item as Currency] && !stock[item as StockItem]);
    const transaction: Transaction = {
      id: makeId(16),
      fromAccountId,
      toAccountId,
      item,
      quantity,
      pricePerUnit: exchangeRates[item as Currency] || 0,
      totalPrice: calculateTotalPrice(quantity, exchangeRates[item as Currency] || 0),
      timestamp: new Date(),
      status: canCreate ? "failed" : "pending",
    };
    return this.processTransaction(transaction);
  }

  private addToHistory(transaction: Transaction): void {
    this.transactionHistory.push(transaction);
    if (this.transactionHistory.length > 100) {
      this.transactionHistory.shift();
    }
  }

  private processTransaction(transaction: Transaction): Transaction {
    if (transaction.status === "failed") {
      this.addToHistory(transaction);
      return transaction;
    }
    // Basic validation and processing logic (to be expanded with actual business rules)
    const fromAccount = this.getAccount(transaction.fromAccountId);
    const toAccount = this.getAccount(transaction.toAccountId);
    // Validate transaction
    const validTransaction = fromAccount && toAccount && transaction.quantity > 0 && transaction.pricePerUnit > 0
      && fromAccount.portfolio.entries[transaction.item]?.quantity >= transaction.quantity
      && transaction.totalPrice === transaction.quantity * transaction.pricePerUnit
      && fromAccount.id !== toAccount.id;
    // If validation fails, mark transaction as failed
    if (!validTransaction) {
      transaction.status = "failed";
      this.addToHistory(transaction);
      return transaction;
    }
    // Update portfolios
    fromAccount.portfolio.entries[transaction.item].quantity -= transaction.quantity;
    toAccount.portfolio.entries[transaction.item] = toAccount.portfolio.entries[transaction.item] || {
      item: transaction.item,
      quantity: 0,
    };
    toAccount.portfolio.entries[transaction.item].quantity += transaction.quantity;
    // Recalculate total values
    fromAccount.portfolio.totalValue = calculateTotalValue(fromAccount.portfolio);
    toAccount.portfolio.totalValue = calculateTotalValue(toAccount.portfolio);
    // Update transaction status, push to history, and shift history if it exceeds 100 transactions
    transaction.status = "completed";
    this.addToHistory(transaction);
    // Update account timestamps
    fromAccount.updatedAt = new Date();
    toAccount.updatedAt = new Date();
    return transaction;
  }

  getTransaction(transactionId: string): Transaction | null {
    return this.transactionHistory.find((tx) => tx.id === transactionId) || null;
  }

  listTransactionsForAccount(accountId: string): Transaction[] {
    return this.transactionHistory.filter(
      (tx) => tx.fromAccountId === accountId || tx.toAccountId === accountId
    );
  }

  clear(): void {
    this.accounts = {};
    this.transactionHistory = [];
  }

  private apiGetAccountRequest(req: Request, res: Response): void {
    const accountId = req.params.accountId as string;
    const account = this.getAccount(accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json({ account });
  }

  private apiPortfolioRequest(req: Request, res: Response): void {
    const accountId = req.params.accountId as string;
    const account = this.getAccount(accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json({ portfolio: Object.values(account.portfolio.entries ?? {}) });
  }

  private apiTransactionRequest(req: Request, res: Response): void {
    const { fromAccountId, toAccountId, item, quantity } = req.body as {
      fromAccountId: string;
      toAccountId: string;
      item: PortfolioItem;
      quantity: number;
    };
    const transaction = this.createTransaction(fromAccountId, toAccountId, item, quantity);
    if (transaction.status === "failed") {
      res.status(400).json({ error: "Transaction failed", transaction });
    } else {
      res.json({ transaction });
    }
  }

  private apiCreateAccountRequest(req: Request, res: Response): void {
    const { profileId } = req.body as { profileId: string };
    const profile = serverState.accounts.get(profileId);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    if (profile.bankAccountId) {
      res.status(400).json({ error: "Profile already has a bank account" });
      return;
    }
    this.createAccount(profile);
    res.json({ success: true, bankAccountId: profile.bankAccountId });
  }

  private apiDeleteAccountRequest(req: Request, res: Response): void {
    const accountId = req.params.accountId as string;
    const account = this.getAccount(accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    this.deleteAccount(accountId);
    res.json({ success: true });
  }
}