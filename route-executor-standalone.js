#!/usr/bin/env node

import { ethers } from 'ethers';

const ALCHEMY_KEY = 'wf-n8242VyUxgSwmWNs9h';
const POLYGON_RPC = `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;

// Your detection engine's endpoint
const DETECTION_ENGINE = process.env.DETECTION_ENGINE_URL || 'https://it-4zsx.bolt.host';

const TREASURY = '0xCD339078D159404D29000A6716D962C8833ABfe8';
const ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff';

const ROUTER_ABI = ['function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'];
const ERC20_ABI = ['function approve(address spender, uint256 amount) external returns (bool)'];

async function getPendingOptimizations() {
  try {
    console.log(`📡 Querying detection engine: ${DETECTION_ENGINE}/route-optimizer/status`);
    const response = await fetch(`${DETECTION_ENGINE}/route-optimizer/status`);
    if (!response.ok) {
      console.error(`HTTP ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.pending || [];
  } catch (err) {
    console.error('Fetch error:', err.message);
    return [];
  }
}

async function execute() {
  if (!RELAYER_KEY) {
    console.error('ERROR: RELAYER_PRIVATE_KEY not set');
    process.exit(1);
  }

  console.log('🚀 RouteOptimization Executor Started');
  console.log(`⏰ ${new Date().toISOString()}`);

  try {
    console.log('📡 Fetching pending optimizations from detection engine...');
    const pending = await getPendingOptimizations();

    if (pending.length === 0) {
      console.log('✅ No pending optimizations');
      return;
    }

    console.log(`📊 Found ${pending.length} pending optimizations\n`);

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

        console.log(`✓ [${selector}] Gas: ${gas_saved} MATIC | Profit: ${ethers.formatUnits(profit, 18)} MATIC`);

        if (profit < ethers.parseUnits('0.001', 18)) {
          console.log(`  ⚠️ Skipped\n`);
          continue;
        }

        if (token_in && token_in !== '0x0000000000000000000000000000000000000000') {
          const erc20 = new ethers.Contract(token_in, ERC20_ABI, relayer);
          await (await erc20.approve(ROUTER, ethers.parseUnits(amount_in.toString(), 18))).wait();
        }

        const amountInWei = ethers.parseUnits(amount_in.toString(), 18);
        const deadline = Math.floor(Date.now() / 1000) + 300;
        const swapTx = await router.swapExactTokensForTokens(amountInWei, 0, optimized_path, relayer.address, deadline);
        const swapReceipt = await swapTx.wait();
        console.log(`  ✅ Swap: ${swapReceipt.hash}`);

        const feeTx = await relayer.sendTransaction({ to: TREASURY, value: fee, gasLimit: 21000 });
        await feeTx.wait();
        console.log(`  ✅ Fee: ${feeTx.hash}\n`);

        executed++;
      } catch (err) {
        console.error(`  ❌ Failed: ${err.message}\n`);
        failed++;
      }
    }

    console.log(`✨ Complete | Executed: ${executed} | Failed: ${failed}`);
  } catch (err) {
    console.error('FATAL ERROR:', err.message);
    process.exit(1);
  }
}

execute();
