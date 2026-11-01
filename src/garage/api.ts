// The garage's calls to the database (see db/schema.sql, "garage, credits,
// levels, challenges"). The server works out credits, levels and progress from
// saved rides, and checks every purchase and claim; nothing here can be faked.

import { neon } from '../cloud/client';
import { parseWallet, type Wallet } from './progression';
import { parseWeek, type WeekState } from './challenges';

async function call(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await neon.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

function need<T>(v: T | null, what: string): T {
  if (!v) throw new Error(`Couldn’t read your ${what}`);
  return v;
}

export const fetchWallet = async (): Promise<Wallet> => need(parseWallet(await call('my_wallet')), 'garage');
export const buyItem = async (id: string): Promise<Wallet> => need(parseWallet(await call('buy_item', { p_item: id })), 'garage');
export const fetchChallenges = async (): Promise<WeekState> => need(parseWeek(await call('my_challenges')), 'challenges');
export const claimChallenge = async (id: string): Promise<Wallet> => need(parseWallet(await call('claim_challenge', { p_id: id })), 'garage');
