import express from 'express';
import cookieParser from 'cookie-parser';
import { authStart, authCallback } from '../lib/oauth.js';

const router = express.Router();
router.use(cookieParser());

router.get('/', authStart);
router.get('/callback', authCallback);

export default router;
