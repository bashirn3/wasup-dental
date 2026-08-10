/**
 * Dry read of what the conversation mirror would produce, without writing.
 *
 * Reads a patient's Leadflo timeline through the feeder and prints the messages
 * the sync would derive from it, so the direction, ordering and prefix
 * stripping can be checked against the real thread before anything is stored.
 *
 * Usage: node scripts/check-leadflo-conversations.mjs <patientId>
 */

const FEEDER = process.env.LEADFLO_FEEDER_URL ?? "https://dental-asthetica.wasup.co";
const TURN = /^\s*(ai|poppy|client|patient)\s*:\s*/i;
const CLINIC_SPEAKERS = new Set(["ai", "poppy"]);

const patientId = process.argv[2];
if (!patientId) {
  console.error("usage: node scripts/check-leadflo-conversations.mjs <patientId>");
  process.exit(1);
}

const response = await fetch(`${FEEDER}/api/leads/${encodeURIComponent(patientId)}/timeline`, {
  headers: { "X-WF1-Key": process.env.LEADFLO_FEEDER_API_KEY ?? "" },
});
if (!response.ok) {
  console.error(`timeline_read_failed:${response.status}`);
  process.exit(1);
}

const { notes = [], lead } = await response.json();
const turns = [];
let skipped = 0;

for (const note of notes) {
  const content = String(note.content ?? "").trim();
  const speaker = TURN.exec(content);
  if (!note.id || !content || !speaker) {
    skipped += 1;
    continue;
  }
  const clinic = CLINIC_SPEAKERS.has(speaker[1].toLowerCase());
  turns.push({
    at: new Date(note.datetime).toISOString(),
    direction: clinic ? "outbound" : "inbound",
    aiGenerated: clinic,
    body: content.slice(speaker[0].length).trim(),
    externalId: String(note.id),
  });
}

turns.sort((a, b) => a.at.localeCompare(b.at));

console.log(`lead: ${lead?.fullName ?? patientId}`);
console.log(`notes: ${notes.length}   conversation turns: ${turns.length}   ignored: ${skipped}\n`);
for (const turn of turns) {
  const who = turn.direction === "outbound" ? "Poppy " : "Patient";
  console.log(`${turn.at}  ${who}  ${turn.body.slice(0, 88)}`);
}

const ids = new Set(turns.map((turn) => turn.externalId));
if (ids.size !== turns.length) {
  console.log(`\nWARNING: ${turns.length - ids.size} duplicate note id(s) in this timeline.`);
}
