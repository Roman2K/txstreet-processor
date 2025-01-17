// @ts-strict-ignore
// Load environment variables from .env
import dotenv from 'dotenv';
dotenv.config();

// Misc imports 
import processTransaction from '../methods/node-subscriber/process-transaction';
import processBlock from '../methods/node-subscriber/process-block';
import mongodb from '../databases/mongodb';
import * as Hooks from '../lib/chain-implementations';
import redis from '../databases/redis';
import config from '../lib/utilities/config';
import { BlockchainWrapper } from '../lib/node-wrappers';
import { startServer as startHealthcheckServer } from '../lib/healthcheck';

// The chain implementations to be processed.
var chainsToSubscribe: string[] = config.mustEnabledChains();
console.log({chainsToSubscribe});

class DisconnectionError extends Error {};

const getLatestBlockLoop = async (wrapper: BlockchainWrapper) => {
    if (process.env.USE_DATABASE !== "true") return;
    const { database } = await mongodb();
    try {
        const height = await getCurrentHeight(wrapper);
        if (!isNaN(height) && height > 100) {
            //height is a valid number
            const heightExistsInDb = await database.collection('blocks').find({ chain: wrapper.ticker, height }).project({ height: 1 }).limit(1).toArray();
            if (!heightExistsInDb || !heightExistsInDb.length) {
                const block = await wrapper.getBlock(height, 2);
                if (block) {
                    console.log(`Height: ${height}, block: ${block}`);


                    await database.collection('blocks').updateOne(
                        { chain: wrapper.ticker, hash: block.hash },
                        { $setOnInsert: { processed: false, locked: false, timestamp: Date.now(), insertedAt: new Date(), processFailures: 0 } },
                        { upsert: true });
                }
            }

        }
    } catch (error) {
        console.error(error);

        if (error instanceof DisconnectionError) {
          process.exit(1);
        }
    }
    setTimeout(() => { getLatestBlockLoop(wrapper); }, 1000);
}

const getCurrentHeight = async (wrapper: BlockchainWrapper): Promise<null | number> => {
  try {
    return await wrapper.getCurrentHeight();
  } catch (err) {
    if (wrapper.isDisconnectError(err)) {
      throw new DisconnectionError(
        `Blockchain client disconnected, exiting: ${err}`
      );
    }

    throw err;
  }
};

const init = async () => {
    // let database: any = null;
    // if (process.env.USE_DATABASE === "true") {
    //     const db = await mongodb();
    //     database = db.database;
    //     await ensureIndexes();
    // }

    if (chainsToSubscribe.includes('BTC')) {
        const wrapperClass = await import("../lib/node-wrappers/BTC");
        let btcWrapper = new wrapperClass.default(
            { username: 'user', password: 'pass', host: process.env.BTC_NODE as string, port: Number(process.env.BTC_NODE_PORT) || 8332 },
            { host: process.env.BTC_NODE as string, port: Number(process.env.BTC_NODE_ZMQPORT) || 28332 });


        Hooks.initHooks('BTC');

        btcWrapper.initEventSystem();

        btcWrapper.on('mempool-tx', (transaction: any) => {
            processTransaction(btcWrapper, { ...transaction, processed: true });
        });

        btcWrapper.on('confirmed-block', (blockHash: string) => {
            processBlock(btcWrapper, blockHash);
        });

        getLatestBlockLoop(btcWrapper);
    }

    if (chainsToSubscribe.includes('BCH')) {
        const wrapperClass = await import("../lib/node-wrappers/BCH");
        let bchWrapper = new wrapperClass.default(
            { username: 'user', password: 'pass', host: process.env.BCH_NODE as string, port: Number(process.env.BCH_NODE_PORT) || 8332 },
            { host: process.env.BCH_NODE as string, port: Number(process.env.BCH_NODE_ZMQPORT) || 28332 });

        Hooks.initHooks('BCH');

        bchWrapper.initEventSystem();

        bchWrapper.on('mempool-tx', (transaction: any) => {
            processTransaction(bchWrapper, { ...transaction, processed: true });
        });

        bchWrapper.on('confirmed-block', (blockHash: string) => {
            processBlock(bchWrapper, blockHash);
        });

        getLatestBlockLoop(bchWrapper);
    }


    if (chainsToSubscribe.includes('LTC')) {
        const wrapperClass = await import("../lib/node-wrappers/LTC");
        let ltcWrapper = new wrapperClass.default(
            { username: 'user', password: 'pass', host: process.env.LTC_NODE as string, port: Number(process.env.LTC_NODE_PORT) || 9332 },
            { host: process.env.LTC_NODE as string, port: Number(process.env.LTC_NODE_ZMQPORT) || 28332 })

        Hooks.initHooks('LTC');

        ltcWrapper.initEventSystem();

        ltcWrapper.on('mempool-tx', (transaction: any) => {
            processTransaction(ltcWrapper, { ...transaction, processed: true });
        });

        ltcWrapper.on('confirmed-block', (blockHash: string) => {
            console.log(`Got block from event: ${blockHash}`);
            processBlock(ltcWrapper, blockHash);
        });

        getLatestBlockLoop(ltcWrapper);
    }

    if (chainsToSubscribe.includes('ETH')) {
        const ethWrapper = config.initEthWrapper();

        Hooks.initHooks('ETH');

        console.log("Imported chain implementations");

        ethWrapper.on('mempool-tx', (transaction: any) => {
            if (!transaction.blockHeight && transaction.blockNumber) {
                transaction.blockHeight = transaction.blockNumber;
                delete transaction.blockNumber;
            }
            processTransaction(ethWrapper, { ...transaction, processed: true });
        });

        ethWrapper.on('confirmed-block', (blockHash: string) => {
            console.log(`Got block from event: ${blockHash}`);
            processBlock(ethWrapper, blockHash);
        });

        getLatestBlockLoop(ethWrapper);

        ethWrapper.initEventSystem();

        console.log("Setup all event processors for chain.");

    }

    if (chainsToSubscribe.includes('ARBI')) {
        const arbiWrapper = config.initArbiWrapper();

        // Hooks.initHooks('ETH', mongodb, redis);

        console.log("Imported chain implementations");

        arbiWrapper.on('confirmed-block', (blockHash: string) => {
            console.log(`Got block from event: ${blockHash}`);
            processBlock(arbiWrapper, blockHash);
        });

        // getLatestBlockLoop(ethWrapper);

        arbiWrapper.initEventSystem();

        console.log("Setup all event processors for chain.");

    }

    if (chainsToSubscribe.includes('XMR')) {
        const wrapperClass = await import("../lib/node-wrappers/XMR");
        let xmrWrapper = new wrapperClass.default(process.env.XMR_NODE as string);
        xmrWrapper.initEventSystem();
        xmrWrapper.on('mempool-tx', (transaction: any) => {
            processTransaction(xmrWrapper, { ...transaction, processed: true });
        });

        xmrWrapper.on('confirmed-block', (hash: any) => {
            processBlock(xmrWrapper, hash);
        });

        getLatestBlockLoop(xmrWrapper);
    }
}

startHealthcheckServer();
init();

export const housingImplementations: any = {};
