const { decodeXmlEntities, extractCalendarData, parseEvents } = require('./ics')
const { utcStamp } = require('./dates')

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** btoa n'existe pas dans le sandbox NotePlan : encodage UTF-8 → base64 à la main. */
function encodeBasicAuth(username, password) {
  const input = `${username}:${password}`
  const bytes = []
  for (const char of input) {
    const code = char.codePointAt(0)
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += BASE64_CHARS[b0 >> 2]
    out += BASE64_CHARS[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)]
    out += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)]
    out += b2 === undefined ? '=' : BASE64_CHARS[b2 & 63]
  }
  return `Basic ${out}`
}

/**
 * fetch() de NotePlan ne donne aucun code HTTP : le succès se déduit du contenu.
 * Toute anomalie lève, pour qu'aucun échec ne passe inaperçu.
 */
function assertMultistatus(response, contexte) {
  const text = typeof response === 'string' ? response : ''
  if (!text.trim()) {
    throw new Error(`${contexte} : réponse vide (panne réseau, timeout ou serveur injoignable)`)
  }
  if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
    throw new Error(`${contexte} : page HTML reçue — identifiants invalides ou session de connexion`)
  }
  const exception = /<[a-z0-9]*:?exception>([\s\S]*?)<\/[a-z0-9]*:?exception>/i.exec(text)
  if (exception) {
    throw new Error(`${contexte} : le serveur a répondu ${exception[1].trim()}`)
  }
  /**
   * Un <d:error> (erreur applicative, maintenance…) peut arriver sans balise
   * exception. On l'extrait avant le contrôle multistatus générique, sinon
   * elle tombe dans le fourre-tout qui déverse 120 caractères de XML brut.
   */
  if (/<[a-z0-9]*:?error[\s/>]/i.test(text)) {
    const message = /<[a-z0-9]*:?message>([\s\S]*?)<\/[a-z0-9]*:?message>/i.exec(text)
    const detail = message ? message[1].trim() : 'aucun détail fourni par le serveur'
    throw new Error(`${contexte} : le serveur a répondu une erreur (${detail})`)
  }
  if (!/<[a-z0-9]*:?multistatus/i.test(text)) {
    throw new Error(`${contexte} : réponse inattendue (${text.slice(0, 120)})`)
  }
  return text
}

function originOf(url) {
  const match = /^(https?:\/\/[^/]+)/i.exec(String(url || ''))
  return match ? match[1] : String(url || '')
}

/** Ne ré-encode JAMAIS : certains href contiennent déjà des %20. */
function absolutize(href, origin) {
  const value = String(href || '')
  if (/^https?:\/\//i.test(value)) return value
  return `${origin}${value.startsWith('/') ? '' : '/'}${value}`
}

function parseCalendarList(xml) {
  const blocks = String(xml || '').match(
    /<[a-z0-9]*:?response[\s\S]*?<\/[a-z0-9]*:?response>/gi,
  ) || []
  const calendars = []
  for (const block of blocks) {
    const isCalendar = /<[a-z0-9]*:?calendar[\s/>]/i.test(block)
    if (!isCalendar) continue
    const hrefMatch = /<[a-z0-9]*:?href>([\s\S]*?)<\/[a-z0-9]*:?href>/i.exec(block)
    const nameMatch = /<[a-z0-9]*:?displayname>([\s\S]*?)<\/[a-z0-9]*:?displayname>/i.exec(block)
    if (!hrefMatch || !nameMatch) continue
    const displayName = decodeXmlEntities(nameMatch[1].trim())
    if (!displayName) continue
    calendars.push({ href: decodeXmlEntities(hrefMatch[1].trim()), displayName })
  }
  return calendars
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>'

/** Détecte une séquence d'échappement % suivie de deux chiffres hexadécimaux. */
function isAlreadyEncoded(value) {
  return /%[0-9a-f]{2}/i.test(value)
}

/** Cohérent avec la règle « ne jamais ré-encoder » appliquée par absolutize. */
function calendarHomeUrl(config) {
  const base = String(config.serverUrl || '').replace(/\/+$/, '')
  if (/\/calendars\//i.test(base)) return `${base}/`
  const username = String(config.username || '')
  const encodedUsername = isAlreadyEncoded(username) ? username : encodeURIComponent(username)
  return `${base}/calendars/${encodedUsername}/`
}

async function discoverCalendars(config) {
  const response = await fetch(calendarHomeUrl(config), {
    method: 'PROPFIND',
    headers: {
      Authorization: encodeBasicAuth(config.username, config.password),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: PROPFIND_BODY,
  })
  const xml = assertMultistatus(response, 'Découverte des calendriers')
  return parseCalendarList(xml).sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'))
}

/**
 * <C:expand> fait développer les récurrences par le serveur : pas de RRULE à
 * interpréter, pas de VTIMEZONE renvoyé, dates normalisées en UTC.
 */
function buildReportBody(from, to) {
  const start = utcStamp(from)
  const end = utcStamp(to)
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    `<d:prop><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>` +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
    `<c:time-range start="${start}" end="${end}"/>` +
    '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>'
  )
}

async function fetchEvents(config, calendarHref, from, to) {
  const url = absolutize(calendarHref, originOf(config.serverUrl))
  const response = await fetch(url, {
    method: 'REPORT',
    headers: {
      Authorization: encodeBasicAuth(config.username, config.password),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: buildReportBody(from, to),
  })
  const xml = assertMultistatus(response, 'Récupération des événements')
  const events = []
  for (const ics of extractCalendarData(xml)) {
    events.push(...parseEvents(ics))
  }
  return events.sort((a, b) => (a.start ? a.start.getTime() : 0) - (b.start ? b.start.getTime() : 0))
}

module.exports = {
  encodeBasicAuth, assertMultistatus, originOf, absolutize, parseCalendarList,
  calendarHomeUrl, discoverCalendars, buildReportBody, fetchEvents,
}
