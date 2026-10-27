// Daily job: moves events older than the retention window to one .xlsx file
// per month in a Google Drive folder, then deletes them from the database.
// An event is deleted only after the file holding it uploaded successfully
// and, read back from Drive, holds every row of it.
import ExcelJS from "npm:exceljs@4.4.0";
import { TIMEZONE } from "../_shared/dates.ts";
import {
  addEmptyEventRow, addRequestRows, archivedEventIds, countEventRows, type ExportRow, REQUEST_SHEET, setupRequestSheet,
} from "../_shared/excel.ts";
import { type JobOutcome, serveJob } from "../_shared/job.ts";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_EVENTS_PER_RUN = 200;

async function driveToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function findFile(token: string, folder: string, name: string): Promise<string | null> {
  const q = `name = '${name}' and '${folder}' in parents and trashed = false`;
  const res = await fetch(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`search: ${res.status} ${await res.text()}`);
  return (await res.json()).files?.[0]?.id ?? null;
}

async function download(token: string, id: string): Promise<ArrayBuffer> {
  const res = await fetch(`${DRIVE}/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`download: ${res.status} ${await res.text()}`);
  return await res.arrayBuffer();
}

async function upload(token: string, folder: string, name: string, existingId: string | null, data: ArrayBuffer) {
  if (existingId) {
    const res = await fetch(`${UPLOAD}/${existingId}?uploadType=media`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": XLSX_MIME },
      body: data,
    });
    if (!res.ok) throw new Error(`update: ${res.status} ${await res.text()}`);
    return;
  }
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ name, parents: [folder] })], { type: "application/json" }));
  form.append("file", new Blob([data], { type: XLSX_MIME }));
  const res = await fetch(`${UPLOAD}?uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`create: ${res.status} ${await res.text()}`);
}

interface ArchivedEvent {
  id: string;
  name: string;
  needed_on: string;
  needed_by: string | null;
  created_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
}

function monthKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit" })
    .formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

const DRIVE_SECRETS = ["DRIVE_FOLDER_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];

/** Rows a monthly file must hold for these events: their requests, or one row for an event with none. */
function expectedRowCount(events: ArchivedEvent[], rows: ExportRow[]): number {
  const withRows = new Set(rows.map((r) => r.event_id));
  return rows.length + events.filter((e) => !withRows.has(e.id)).length;
}

async function loadSheet(data: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.getWorksheet(REQUEST_SHEET);
  if (ws) setupRequestSheet(ws);
  return ws;
}

serveJob("archive", [], async (db): Promise<JobOutcome> => {
  // Until Drive is set up there is nothing to archive to. The health check
  // reads "configured" and checks the archive only once it is true.
  if (DRIVE_SECRETS.some((name) => !Deno.env.get(name))) return { summary: { configured: false, archived: 0 } };
  const folder = Deno.env.get("DRIVE_FOLDER_ID")!;

  const { data, error } = await db.rpc("archive_candidates").limit(MAX_EVENTS_PER_RUN);
  if (error) throw error;
  const events = data as ArchivedEvent[] | null;
  if (!events?.length) return { summary: { configured: true, archived: 0, months: 0 } };

  const byMonth = new Map<string, ArchivedEvent[]>();
  for (const e of events) {
    const key = monthKey(e.cancelled_at ?? e.closed_at ?? e.created_at);
    byMonth.set(key, [...(byMonth.get(key) ?? []), e]);
  }

  const token = await driveToken();
  let archived = 0;
  const failures: string[] = [];

  for (const [month, monthEvents] of byMonth) {
    try {
      const ids = monthEvents.map((e) => e.id);
      const { data: rows, error: rowsError } = await db.from("export_rows").select("*")
        .in("event_id", ids).order("event_created_at").order("company_name").order("supplier_name");
      if (rowsError) throw rowsError;
      const monthRows = (rows ?? []) as ExportRow[];

      const name = `logistics-${month}.xlsx`;
      const existingId = await findFile(token, folder, name);
      const wb = new ExcelJS.Workbook();
      let ws;
      if (existingId) {
        await wb.xlsx.load(await download(token, existingId));
        ws = wb.getWorksheet(REQUEST_SHEET);
      }
      if (!ws) ws = wb.addWorksheet(REQUEST_SHEET);
      // Column keys are not stored in the file, so set them on every run.
      setupRequestSheet(ws);

      // An earlier run may have uploaded these events and then failed to
      // delete them. Their rows are already in the file: don't add them twice.
      const alreadyInFile = archivedEventIds(ws);
      const newRows = monthRows.filter((r) => !alreadyInFile.has(r.event_id));
      const withRows = new Set(monthRows.map((r) => r.event_id));
      const newEmptyEvents = monthEvents.filter((e) => !withRows.has(e.id) && !alreadyInFile.has(e.id));

      if (newRows.length || newEmptyEvents.length) {
        addRequestRows(ws, newRows);
        newEmptyEvents.forEach((e) => addEmptyEventRow(ws, e));
        await upload(token, folder, name, existingId, await wb.xlsx.writeBuffer());
      }

      // Read the file back from Drive: delete only what it really holds.
      const uploadedId = await findFile(token, folder, name);
      const uploaded = uploadedId ? await loadSheet(await download(token, uploadedId)) : undefined;
      const inFile = uploaded ? countEventRows(uploaded, new Set(ids)) : 0;
      const expected = expectedRowCount(monthEvents, monthRows);
      if (inFile !== expected) throw new Error(`file holds ${inFile} rows, expected ${expected}; nothing deleted`);

      const { error: delError } = await db.from("events").delete().in("id", ids);
      if (delError) throw delError;
      archived += ids.length;
    } catch (e) {
      failures.push(`${month}: ${(e as Error).message}`);
    }
  }
  return {
    summary: { configured: true, archived, months: byMonth.size, failed_months: failures.length },
    error: failures.length ? failures.join("; ") : undefined,
  };
});
