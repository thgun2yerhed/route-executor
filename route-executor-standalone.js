#!/usr/bin/env node

import express from 'express';
import { ethers } from 'ethers';

const app = express();
const ALCHEMY_KEY = 'wf-n8242VyUxgSwmWNs9h';
const POLYGON_RPC = `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;
const DETECTION_ENGINE = process.env.DETECTION_ENGINE_URL || 'https://it-4zsx.bolt.host';
const TREASURY = '0xCD339078D159404D29000A6716D962C8833ABfe8';
const ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff';

const ROUTER_ABI = ['function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'];
const ERC20_ABI = ['function approve(address spender, uint256 amount) external returns (bool)'];

async function getPendingOptimizations() {
  try {
    const response = await fetch(`${DETECTION_ENGINE}/route-optimizer/status`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.pending || [];
  } catch (err) {
    console.error('Fetch error:', err.message);
    return [];
  }
}

async function executeOptimizations() {
  if (!RELAYER_KEY) {
    return { error: 'RELAYER_PRIVATE_KEY not set' };
  }

  try {
    console.log('🚀 Executor started at', new Date().toISOString());
    const pending = await getPendingOptimizations();

    if (pending.length === 0) {
      return { message: 'No pending optimizations' };
    }

    console.log(`📊 Found ${pending.length} pending optimizations`);

    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const relayer = new ethers.Wallet(RELAYER_KEY, provider);
    const router = new ethers.Contract(ROUTER, ROUTER_ABI, relayer);

    let executed = 0, failed = 0;

    for (const opt of pending) {
      try {
        const { selector, amount_in, token_in, optimized_path, gas_saved } = opt;
        const gasSavedWei = ethers.parseUnits(gas_saved.toString(), 18);
        const fee = (gasSavedWei * BigInt(3)) / BigInt(1000);
        const profit = gasSavedWei - fee;

        if (profit < ethers.parseUnits('0.001', 18)) continue;

        if (token_in && token_in !== '0x0000000000000000000000000000000000000000') {
          const erc20 = new ethers.Contract(token_in, ERC20_ABI, relayer);
          await (await erc20.approve(ROUTER, ethers.parseUnits(amount_in.toString(), 18))).wait();
        }

        const amountInWei = ethers.parseUnits(amount_in.toString(), 18);
        const deadline = Math.floor(Date.now() / 1000) + 300;
        const swapTx = await router.swapExactTokensForTokens(amountInWei, 0, optimized_path, relayer.address, deadline);
        const swapReceipt = await swapTx.wait();

        const feeTx = await relayer.sendTransaction({ to: TREASURY, value: fee, gasLimit: 21000 });
        await feeTx.wait();

        console.log(`✅ Executed ${selector}: ${swapReceipt.hash}`);
        executed++;
      } catch (err) {
        console.error(`❌ Failed: ${err.message}`);
        failed++;
      }
    }

    return { executed, failed, total: pending.length };
  } catch (err) {
    return { error: err.message };
  }
}

app.get('/execute', async (req, res) => {
  const result = await executeOptimizations();
  res.json(result);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Executor running on port ${PORT}`);
});
