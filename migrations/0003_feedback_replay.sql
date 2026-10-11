-- Feedback can point at the sender's last game (its replay id; open it at /?replay=<id>).
ALTER TABLE feedback ADD COLUMN replay_id TEXT;
