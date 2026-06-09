import express from 'express';
import { bootstrap } from '../src/main';

const expressApp = express();
let bootstrapError: any = null;

const appPromise = bootstrap(expressApp).catch(err => {
  bootstrapError = err;
  console.error('Bootstrap failed:', err);
});

export default async function handler(req: any, res: any) {
  if (bootstrapError) {
    return res.status(500).json({
      error: 'Bootstrap failed during serverless function startup',
      message: bootstrapError.message || String(bootstrapError),
      stack: bootstrapError.stack,
    });
  }

  try {
    await appPromise;
    if (bootstrapError) {
      return res.status(500).json({
        error: 'Bootstrap failed during serverless function startup',
        message: bootstrapError.message || String(bootstrapError),
        stack: bootstrapError.stack,
      });
    }
    expressApp(req, res);
  } catch (err: any) {
    return res.status(500).json({
      error: 'Runtime request execution failed',
      message: err.message || String(err),
      stack: err.stack,
    });
  }
}
