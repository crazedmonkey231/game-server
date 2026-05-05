import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import { makeId } from "../../utils";
import { Account, Service } from "../../types";
import { serverState } from "../serverstate";

export class AccountsService implements Service {
  name = "Accounts";
  private accounts: Map<string, Account> = new Map<string, Account>();
  private io?: IOServer;

  constructor() {

  }
  
  createAccount(id: string, name: string): Account {
    const account: Account = {
      id,
      name: name,
      createdAt: new Date(),
      bankAccountId: "",
      stats: {
        gamesPlayed: 0,
        gamesWon: 0,
        totalKills: 0,
        totalDeaths: 0,
      },
    };
    this.accounts.set(id, account);
    serverState.bank.createAccount(account);
    return account;
  }

  deleteAccount(id: string): void {
    if (this.accounts.has(id)) {
      const account = this.accounts.get(id)!;
      const accountAgeSeconds = (Date.now() - new Date(account.createdAt).getTime()) / 1000;
      console.log(`Deleting account ${id} (age: ${accountAgeSeconds.toFixed(2)} seconds)`);
      serverState.globalStats.globalPlayTime += accountAgeSeconds;
      this.accounts.delete(id);
      serverState.bank.deleteAccount(account.bankAccountId);
    }
  }

  get(accountId: string): Account | null {
    return this.accounts.get(accountId) || null;
  }

  clear(): void {
    this.accounts.clear();
  }

  /** API route handlers for account operations */
  registerRoutes(app: Application, io: IOServer): void {
    this.io = io;
    app.get("/api/accounts/searchAccount/:socketId", this.apiSearchAccountRequest.bind(this));
    app.post("/api/accounts/createAccount", this.apiCreateAccountRequest.bind(this));
    app.post("/api/accounts/deleteAccount", this.apiDeleteAccountRequest.bind(this));
    app.post("/api/accounts/login", this.apiLoginRequest.bind(this));
  }

  private apiCreateAccountRequest(req: Request, res: Response): void {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const id = makeId(16);
    const account = this.createAccount(id, name);
    this.accounts.set(id, account);
    res.json(account);
  }

  private apiDeleteAccountRequest(req: Request, res: Response): void {
    const { id } = req.body as { id: string };
    if (!id) {
      res.status(400).json({ error: "Account ID is required" });
      return;
    }
    if (!this.accounts.has(id)) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const account = this.accounts.get(id)!;
    const accountAgeSeconds = (Date.now() - new Date(account.createdAt).getTime()) / 1000;
    console.log(`Deleting account ${id} (age: ${accountAgeSeconds.toFixed(2)} seconds)`);
    this.deleteAccount(id);
    res.json({ success: true });
  }

  private apiSearchAccountRequest(req: Request, res: Response): void {
    const { socketId } = req.params as { socketId: string };
    const account = this.accounts.get(socketId);
    if (account) {
      res.json(account);
    }
    else {
      res.status(404).json({ error: "Account not found" });
    }
  }

  private apiLoginRequest(req: Request, res: Response): void {
    const { socketId, name } = req.body as { socketId?: string; name?: string };
    console.log(`Login request for socketId: ${socketId}, name: ${name}`);
    if (!socketId || !name) {
      res.status(400).json({ error: "Missing socketId or name" });
      return;
    }
    if (this.accounts.has(socketId)) {
      const account = this.accounts.get(socketId)!;
      res.json({ success: true, account });
      return;
    }
    res.status(404).json({ error: "Account not found" });
  }
}