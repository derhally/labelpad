import QRCode from "qrcode";
import type { QrElement, QrType } from "./types";

/** The fields each type of QR code is built from. */
export const QR_FIELDS: Record<QrType, (keyof QrElement)[]> = {
  link: ["value"],
  text: ["value"],
  email: ["email", "subject", "body"],
  wifi: ["ssid", "password", "security", "hidden"],
  phone: ["phone"],
  sms: ["phone", "body"],
  contact: ["name", "phone", "email", "company", "jobTitle", "website", "address"],
  location: ["latitude", "longitude"],
};

/** The text fields of a QR code that can hold placeholders such as {count}. */
export function qrTexts(el: QrElement): string[] {
  return QR_FIELDS[el.qrType].map((k) => el[k]).filter((v): v is string => typeof v === "string");
}

/**
 * What a QR code encodes, in the form phone cameras recognize. Throws a
 * message for the user when a needed field is missing or invalid.
 */
export function qrPayload(el: QrElement): string {
  switch (el.qrType) {
    case "text":
      if (!el.value) throw new Error("Enter some text");
      return el.value;
    case "link": {
      const url = el.value.trim();
      if (!url) throw new Error("Enter a link");
      // "example.com" opens as a search on some phones; give it a scheme.
      return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    }
    case "email": {
      const to = el.email.trim();
      if (!to) throw new Error("Enter an email address");
      const query = [el.subject && `subject=${encodeURIComponent(el.subject)}`, el.body && `body=${encodeURIComponent(el.body)}`].filter(Boolean).join("&");
      return `mailto:${encodeURIComponent(to).replace(/%40/g, "@").replace(/%2B/g, "+")}${query ? `?${query}` : ""}`;
    }
    case "wifi": {
      if (!el.ssid) throw new Error("Enter the network name");
      if (el.security !== "nopass" && !el.password) throw new Error("Enter the password, or set security to None");
      const parts = [`T:${el.security}`, `S:${wifiEscape(el.ssid)}`];
      if (el.security !== "nopass") parts.push(`P:${wifiEscape(el.password)}`);
      if (el.hidden) parts.push("H:true");
      return `WIFI:${parts.join(";")};;`;
    }
    case "phone":
      return `tel:${phoneNumber(el.phone)}`;
    case "sms":
      return `SMSTO:${phoneNumber(el.phone)}:${el.body}`;
    case "contact":
      return vCard(el);
    case "location": {
      const lat = coordinate(el.latitude, 90, "latitude");
      const lon = coordinate(el.longitude, 180, "longitude");
      return `geo:${lat},${lon}`;
    }
  }
}

/** Wi-Fi QR codes escape \ ; , : and " with a backslash. */
function wifiEscape(s: string): string {
  return s.replace(/([\\;,:"])/g, "\\$1");
}

/** A number as dialers take it: digits and + * # only, without spaces or brackets. */
function phoneNumber(s: string): string {
  const n = s.replace(/[\s().-]/g, "");
  if (!n) throw new Error("Enter a phone number");
  if (!/^\+?[0-9*#]+$/.test(n)) throw new Error("A phone number can only have digits, spaces, + ( ) and -");
  return n;
}

function coordinate(s: string, limit: number, what: string): string {
  const t = s.trim();
  const n = Number(t);
  if (!t || !Number.isFinite(n)) throw new Error(`Enter the ${what} in degrees, such as ${what === "latitude" ? "51.5007" : "-0.1246"}`);
  if (Math.abs(n) > limit) throw new Error(`The ${what} should be between -${limit} and ${limit}`);
  return String(n);
}

/** A vCard 3.0, which iPhone and Android cameras both offer to save as a contact. */
function vCard(el: QrElement): string {
  const name = el.name.trim();
  if (!name && !el.company.trim()) throw new Error("Enter a name or a company");
  // N is family;given. Take the last word as the family name.
  const words = name.split(/\s+/).filter(Boolean);
  const family = words.at(-1) ?? "";
  const given = words.slice(0, -1).join(" ");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vEscape(family)};${vEscape(given)};;;`,
    `FN:${vEscape(name || el.company.trim())}`,
    el.company.trim() && `ORG:${vEscape(el.company.trim())}`,
    el.jobTitle.trim() && `TITLE:${vEscape(el.jobTitle.trim())}`,
    el.phone.trim() && `TEL;TYPE=CELL:${phoneNumber(el.phone)}`,
    el.email.trim() && `EMAIL:${vEscape(el.email.trim())}`,
    el.website.trim() && `URL:${vEscape(el.website.trim())}`,
    el.address.trim() && `ADR:;;${vEscape(el.address.trim())};;;;`,
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\r\n");
}

/** vCard text escapes backslashes, commas, semicolons and line breaks. */
function vEscape(s: string): string {
  return s.replace(/([\\,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

/**
 * How a QR code fits its box: its size in squares ("modules") and how many
 * printer dots each square gets. Throws when the code can't be built.
 */
export function qrFit(el: QrElement, side: number): { modules: number; dots: number; code: QRCode.BitMatrix } {
  const code = QRCode.create(qrPayload(el), { errorCorrectionLevel: el.errorCorrection }).modules;
  return { modules: code.size, dots: Math.floor(side / code.size), code };
}

/** Squares smaller than this many dots print blurred on thermal heads and scan poorly. */
export const QR_MIN_DOTS = 3;
