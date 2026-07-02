import express from "express";
import {
  getPoints,
  blockPoints,
  unblockPoints,
} from "../controllers/loyaltyController.js";

const router = express.Router();

router.post("/get-points", getPoints);
router.post("/block-points", blockPoints);
router.post("/unblock-points", unblockPoints);

export default router;