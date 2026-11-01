-- NULL represents Unfilled; a 32-byte hash represents Filled. Deriving assignment
-- from the hash avoids a separate state flag that could contradict its presence.
ALTER TABLE otp_request
    ALTER COLUMN otp_hash DROP NOT NULL,
    ADD CONSTRAINT otp_request_hash_length CHECK (
        otp_hash IS NULL OR octet_length(otp_hash) = 32
    );
