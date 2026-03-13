import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
    createUserProfile,
    getUserProfile,
    updateUserProfile,
} from '../controllers/auth.controller.js';

const router = Router();

// Create user profile after Firebase Auth sign-up
router.post('/profile', requireAuth, createUserProfile);

// Get current user profile
router.get('/profile', requireAuth, getUserProfile);

// Update user profile
router.put('/profile', requireAuth, updateUserProfile);

export default router;
