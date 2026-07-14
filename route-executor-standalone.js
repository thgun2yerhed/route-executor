#!/usr/bin/env node

import { ethers } from 'ethers';

const ALCHEMY_KEY = 'wf-n8242VyUxgSwmWNs9h';
const POLYGON_RPC = `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;
const TREASURY = '0xCD339078D159404D29000A6716D962C8833ABfe8';
const ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff';

const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
];

const ERC20_ABI = ['function approve(address spender, uint256 amount) external returns (bool)'];

async function execute() {
  if (!RELAYER_KEY) {
    console.error('ERROR: RELAYER_PRIVATE_KEY not set');
    process.exit(1);
  }

  console.log('🚀 RouteOptimization Executor Started');
  console.log(`⏰ ${new Date().toISOString()}`);

  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const relayer = new ethers.Wallet(RELAYER_KEY, provider);
    const router = new ethers.Contract(ROUTER, ROUTER_ABI, relayer);

    const testOptimizations = [
      {
        selector: '0x5c11d795',
        amount_in: '1.5',
        token_in: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
        optimized_path: [
          '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
          '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        ],
        gas_saved: '0.005',
      },
    ];

    console.log(`📊 Processing ${testOptimizations.length} optimizations`);

    for (const opt of testOptimizations) {
      try {
        const { selector, amount_in, token_in, optimized_path, gas_saved } = opt;

        const gasSavedWei = ethers.parseUnits(gas_saved, 18);
        const fee = (gasSavedWei * BigInt(3)) / BigInt(1000);
        const profit = gasSavedWei - fee;

        console.log(`\n✓ [${selector}]`);
        console.log(`  Gas Saved: ${gas_saved} MATIC`);
        console.log(`  Fee (0.3%): ${ethers.formatUnits(fee, 18)} MATIC`);
        console.log(`  Profit: ${ethers.formatUnits(profit, 18)} MATIC`);

        if (profit < ethers.parseUnits('0.001', 18)) {
          console.log(`  ⚠️ SKIPPED: Below profit threshold`);
          continue;
        }

        if (token_in !== '0x0000000000000000000000000000000000000000') {
          const erc20 = new ethers.Contract(token_in, ERC20_ABI, relayer);
          const approveTx = await erc20.approve(
            ROUTER,
            ethers.parseUnits(amount_in, 18)
          );
          console.log(`  ↳ Approving token...`);
          await approveTx.wait();
        }

        const amountInWei = ethers.parseUnits(amount_in, 18);
        const deadline = Math.floor(Date.now() / 1000) + 300;

        const swapTx = await router.swapExactTokensForTokens(
          amountInWei,
          0,
          optimized_path,
          relayer.address,
          deadline
        );

        console.log(`  ↳ Executing swap...`);
        const swapReceipt = await swapTx.wait();
        console.log(`  ✅ Swap: ${swapReceipt.hash}`);

        const feeTx = await relayer.sendTransaction({
          to: TREASURY,
          value: fee,
          gasLimit: 21000,
        });
        console.log(`  ↳ Transferring fee to treasury...`);
        await feeTx.wait();
        console.log(`  ✅ Fee: ${feeTx.hash}`);
      } catch (err) {
        console.error(`  ❌ FAILED: ${err.message}`);
      }
    }

    console.log(`\n✨ Execution complete`);
  } catch (err) {
    console.error('FATAL ERROR:', err.message);
    process.exit(1);
  }
}

execute();
