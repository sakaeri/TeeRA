-- ConflictOverride.newShiftId was unique, limiting a single new shift to
-- overriding exactly one conflicting shift. A new shift can now supersede
-- multiple overlapping shifts at once (one ConflictOverride row each),
-- while overriddenShiftId stays unique — each old shift can still only be
-- superseded once.
DROP INDEX "ConflictOverride_newShiftId_key";
CREATE INDEX "ConflictOverride_newShiftId_idx" ON "ConflictOverride"("newShiftId");
