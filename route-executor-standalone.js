#!/usr/bin/env node

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';

const ALCHEMY_KEY = 'wf-n8242VyUxgSwmWNs9h';
const POLYGON_RPC = `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;

const SUPABASE_URL = 'https://0ec90b57d6e95fcbda19832f.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IjBlYzkwYjU3ZDZlOTVmY2JkYTE5ODMyZiIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzE4NTY3MjAwLCJleHAiOjE3MzQxMTkyMDB9.fake';

const TREASURY = '0xCD339078D159404D29000A6716D962C8833ABfe8';
const ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff';

const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
];

const ERC20_ABI = ['function approve(address spender, uint256 amount) external returns (bool)'];

async function getPendingOptimizations() {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('status', 'pending')
      .order('gas_saved', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Failed to fetch pending optimizations:', err.message);
    return [];
  }
}

async function updateOptimizationStatus(selector, status, txHash = null) {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const update = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (txHash) {
      update.tx_hash = txHash;
    }

    const { error } = await supabase
      .from('transactions')
      .update(update)
      .eq('selector', selector);

    if (error) console.error('Update error:', error);
  } catch (err) {
    console.error('Failed to update status:', err.message);
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
    console.log('📡 Fetching pending optimizations from Supabase...');
    const pending = await getPendingOptimizations();

    if (pending.length === 0) {
      console.log('✅ No pending optimizations');
      return;
    }

    console.log(`📊 Found ${pending.length} pending optimizations\n`);

    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const relayer = new ethers.Wallet(RELAYER_KEY, provider);
    const router = new ethers.Contract(ROUTER, ROUTER_ABI, relayer);

    let executed = 0;
    let failed = 0;

    for (const opt of pending) {
      try {
        const { selector, amount_in, token_in, optimized_path, gas_saved } = opt;

        const gasSavedWei = ethers.parseUnits(gas_saved.toString(), 18);
        const fee = (gasSavedWei * BigInt(3)) / BigInt(1000);
        const profit = gasSavedWei - fee;

        console.log(`✓ [${selector}]`);
        console.log(`  Gas Saved: ${gas_saved} MATIC`);
        console.log(`  Fee (0.3%): ${ethers.formatUnits(fee, 18)} MATIC`);
        console.log(`  Profit: ${ethers.formatUnits(profit, 18)} MATIC`);

        if (profit < ethers.parseUnits('0.001', 18)) {
          console.log(`  ⚠️ SKIPPED: Below profit threshold\n`);
          continue;
        }

        if (token_in && token_in !== '0x0000000000000000000000000000000000000000') {
          const erc20 = new ethers.Contract(token_in, ERC20_ABI, relayer);
          const approveTx = await erc20.approve(
            ROUTER,
            ethers.parseUnits(amount_in.toString(), 18)
          );
          console.log(`  ↳ Approving token...`);
          await approveTx.wait();
        }

        const amountInWei = ethers.parseUnits(amount_in.toString(), 18);
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
        console.log(`  ↳ Transferring fee...`);
        await feeTx.wait();
        console.log(`  ✅ Fee: ${feeTx.hash}\n`);

        await updateOptimizationStatus(selector, 'executed', swapReceipt.hash);

        executed++;
      } catch (err) {
        console.error(`  ❌ FAILED: ${err.message}\n`);
        failed++;

        if (opt.selector) {
          await updateOptimizationStatus(opt.selector, 'failed');
        }
      }
    }

    console.log(`\n✨ Execution complete`);
    console.log(`   Executed: ${executed}`);
    console.log(`   Failed: ${failed}`);
  } catch (err) {
    console.error('FATAL ERROR:', err.message);
    process.exit(1);
  }
}

execute();
