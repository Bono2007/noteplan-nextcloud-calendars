/**
 * Plugin NotePlan « Agendas Nextcloud » — FICHIER GÉNÉRÉ, NE PAS ÉDITER.
 * Source : src/*.js — régénérer avec : node build.mjs
 */

// ─── dates.js ────────────────────────────────────────────────────

const TIMEZONE = 'Europe/Paris'
const DAY_MS = 24 * 60 * 60 * 1000

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/**
 * Décompose une date dans le fuseau de Paris.
 * Intl est la seule voie fiable : il gère l'heure d'été sans table en dur.
 */
function toParisParts(date) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  // en-GB rend minuit comme 24 : on ramène à 0
  if (parts.hour === 24) parts.hour = 0
  return parts
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0')
}

function dateKey(date) {
  const { year, month, day } = toParisParts(date)
  return `${year}${pad(month)}${pad(day)}`
}

function isoDay(date) {
  const { year, month, day } = toParisParts(date)
  return `${year}-${pad(month)}-${pad(day)}`
}

function utcStamp(date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

/**
 * Convertit une heure civile de Paris en instant UTC.
 * Seule fonction du projet à faire cette conversion : ics.js l'utilise aussi.
 *
 * Convergence par point fixe : un sondage unique se trompe quand l'instant
 * naïf (heure civile traitée comme UTC) tombe de l'autre côté d'une bascule
 * heure d'été/hiver par rapport à l'instant réellement cherché. On part
 * d'une estimation, on regarde l'heure civile parisienne qu'elle produit
 * réellement, on corrige l'écart, et on recommence. Deux itérations
 * suffisent pour Europe/Paris (un seul changement d'offset possible dans la
 * plage concernée).
 * Cas particulier : si l'heure civile demandée n'existe pas (ex. 02h30 le
 * jour du passage à l'heure d'été), il n'y a pas de réponse unique correcte ;
 * la fonction retourne un instant plausible sans planter.
 */
function parisLocalFromParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second)
  let estimate = target
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const shown = toParisParts(new Date(estimate))
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, second)
    estimate += target - shownAsUtc
  }
  return new Date(estimate)
}

/** Minuit à Paris pour le jour de `date`, exprimé en instant UTC. */
function parisMidnight(date) {
  const { year, month, day } = toParisParts(date)
  return parisLocalFromParts(year, month, day, 0, 0, 0)
}

function windowBounds(start, daysAhead) {
  const from = parisMidnight(start)
  const to = parisMidnight(new Date(from.getTime() + daysAhead * DAY_MS + DAY_MS / 2))
  return { from, to }
}

function dayList(start, daysAhead) {
  const first = parisMidnight(start)
  const days = []
  for (let index = 0; index < daysAhead; index += 1) {
    // +12 h avant de renormaliser : évite les surprises aux changements d'heure
    days.push(parisMidnight(new Date(first.getTime() + index * DAY_MS + DAY_MS / 2)))
  }
  return days
}

function formatFrenchDate(date) {
  const { year, month, day } = toParisParts(date)
  const weekday = WEEKDAYS_FR[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  const label = `${weekday} ${pad(day)} ${MONTHS_FR[month - 1]} ${year}`
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatTime(date) {
  const { hour, minute } = toParisParts(date)
  return `${pad(hour)}:${pad(minute)}`
}

// ─── ics.js ──────────────────────────────────────────────────────

/**
 * Le & doit être décodé en DERNIER, sinon "&amp;lt;" donnerait "<"
 * au lieu de "&lt;". Même règle pour les entités numériques : le serveur
 * CalDAV encode les fins de ligne en "&#13;" (retour chariot) — décoder ces
 * entités avant &amp; évite qu'une séquence littérale "&amp;#13;" (qui doit
 * rester le texte "&#13;") ne soit prise à tort pour un retour chariot.
 */
function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, '&')
}

/** Les lignes ICS > 75 octets sont pliées : la suite commence par un blanc. */
function unfoldIcs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
}

/**
 * Passe unique, comme decodeXmlEntities : \\ doit être reconnu AVANT \n,
 * sinon deux backslashes suivis d'un "n" (ex. "C:\\nomFichier") seraient
 * mal interprétés comme un backslash puis un saut de ligne \n, au lieu
 * d'un unique backslash littéral suivi de "nomFichier". Des remplacements
 * successifs (comme précédemment) rescannent le texte déjà transformé et
 * retombent dans ce piège ; une seule passe avec alternance ordonnée l'évite.
 */
function unescapeIcsText(value) {
  return String(value || '').replace(/\\\\|\\n|\\,|\\;/gi, (token) => {
    switch (token.toLowerCase()) {
      case '\\\\':
        return '\\'
      case '\\n':
        return '\n'
      case '\\,':
        return ','
      case '\\;':
        return ';'
      default:
        return token
    }
  })
}

/**
 * `isDateOnly` : DTSTART;VALUE=DATE:20251201 → minuit à Paris.
 * Sinon : 20251209T090000Z (UTC) ou 20251209T100000 (heure locale de Paris).
 */
function parseIcsDate(raw, isDateOnly) {
  const value = String(raw || '').trim()
  if (isDateOnly || /^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(4, 6))
    const day = Number(value.slice(6, 8))
    // parisLocalFromParts vient de dates.js — ne pas réimplémenter ici.
    return parisLocalFromParts(year, month, day, 0, 0, 0)
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi, s, zulu] = match
  if (zulu === 'Z') {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
  }
  return parisLocalFromParts(+y, +mo, +d, +h, +mi, +s)
}

function extractCalendarData(xml) {
  const blocks = String(xml || '').match(
    /<[a-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[a-z0-9]*:?calendar-data>/gi,
  )
  if (!blocks) return []
  return blocks
    .map((block) => {
      const inner = /<[a-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[a-z0-9]*:?calendar-data>/i.exec(block)
      return inner ? decodeXmlEntities(inner[1]) : ''
    })
    .filter((value) => value.trim().length > 0)
}

function parseEvents(ics) {
  const lines = unfoldIcs(ics).split('\n')
  const events = []
  let current = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'BEGIN:VEVENT') {
      current = { summary: '', location: '', start: null, end: null, allDay: false }
      continue
    }
    if (trimmed === 'END:VEVENT') {
      if (current && current.start) events.push(current)
      current = null
      continue
    }
    if (!current) {
      // Hors VEVENT : on ignore tout, y compris les DTSTART des VTIMEZONE.
      continue
    }

    const separator = trimmed.indexOf(':')
    if (separator === -1) continue
    const rawName = trimmed.slice(0, separator)
    const value = trimmed.slice(separator + 1)
    const name = rawName.split(';')[0].toUpperCase()
    const isDateOnly = /VALUE=DATE(?!-)/i.test(rawName)

    if (name === 'SUMMARY') current.summary = unescapeIcsText(value)
    else if (name === 'LOCATION') current.location = unescapeIcsText(value)
    else if (name === 'DTSTART') {
      current.start = parseIcsDate(value, isDateOnly)
      current.allDay = isDateOnly || /^\d{8}$/.test(value.trim())
    } else if (name === 'DTEND') {
      current.end = parseIcsDate(value, isDateOnly)
    }
  }
  return events
}

// ─── caldav.js ───────────────────────────────────────────────────

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

// ─── format.js ───────────────────────────────────────────────────

const MONDAY_TT = /^lundi\s+.*\bTT\b/i

/** Retire emojis et ponctuation de tête pour ne garder que les mots. */
function words(text) {
  return String(text || '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function initialsOf(text) {
  const parts = words(text)
  if (!parts.length) return ''
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/**
 * Les displayName suivent souvent « Prénom NOM (NOM Prénom) ».
 * Un début en sigle (2-3 lettres majuscules, ex. « UE ») n'identifie personne :
 * on prend alors le contenu de la parenthèse.
 */
function guessLabel(displayName) {
  const raw = String(displayName || '').trim()
  const parenthesis = /\(([^)]+)\)/.exec(raw)
  const before = raw.replace(/\([^)]*\)/g, '').trim()
  const beforeWords = words(before)
  const isAcronym = beforeWords.length === 1 && /^[A-ZÉÈÊÀÂÎÔÛÇ]{2,3}$/.test(beforeWords[0])
  if ((isAcronym || !beforeWords.length) && parenthesis) {
    return initialsOf(parenthesis[1])
  }
  return initialsOf(before) || initialsOf(raw)
}

function isMondayTT(summary) {
  return MONDAY_TT.test(String(summary || '').trim())
}

/**
 * Une ligne de bloc doit toujours rester une seule ligne physique : un lieu ou
 * un titre peut contenir des sauts de ligne (unescapeIcsText les produit
 * délibérément), et un message d'erreur peut embarquer du XML multi-ligne.
 * Sans cet aplatissement, les lignes surnuméraires sortent de la détection de
 * fin de bloc (findBlockRange) et s'accumulent à chaque rafraîchissement.
 */
function flattenWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function formatEventLine(event) {
  const summary = flattenWhitespace(event.summary) || '(sans titre)'
  if (event.allDay) return `Journée : ${summary}`
  if (!event.start) return summary
  const start = formatTime(event.start)
  if (!event.end) return `${start} ${summary}`
  return `${start}-${formatTime(event.end)} ${summary}`
}

/**
 * Choc en bout de chaîne : quelle que soit l'origine d'une ligne (événement
 * formaté, message d'erreur, Lundi TT reporté…), elle passe forcément par ici
 * avant d'entrer dans le bloc — aucun chemin ne peut contourner l'aplatissement.
 */
function buildDayBlock({ date, entries, blockTitle }) {
  const header = `> ${blockTitle} : ${formatFrenchDate(date)}`
  const body = entries.map((entry) => {
    const lines = (entry.lines || []).map(flattenWhitespace)
    const content = lines.length ? lines.join(', ') : 'Aucun événement'
    return `\t> ${flattenWhitespace(entry.label)} : ${content}`
  })
  return [header, ...body].join('\n')
}

// ─── noteplan.js ─────────────────────────────────────────────────

/**
 * Le bloc commence à la ligne « > <titre> » en colonne 0 et se poursuit tant
 * que les lignes suivantes sont À LA FOIS indentées (tabulation ou espaces en
 * tête) ET commencent par « > » une fois cette indentation retirée — c'est
 * exactement la forme que le plugin génère. La première ligne qui rompt
 * cette règle (ou une ligne vide) marque la fin du bloc.
 *
 * Une ligne non indentée commençant par « > » (une citation utilisateur en
 * colonne 0, par exemple) ne remplit qu'une des deux conditions et n'est donc
 * pas absorbée. Une ligne indentée commençant elle aussi par « > » reste un
 * cas ambigu, inhérent au choix de délimiter le bloc sans marqueur technique
 * dédié : ce n'est pas résolu ici.
 */
function findBlockRange(lines, blockTitle) {
  const startIndex = lines.findIndex((line) => line.trimStart().startsWith(`> ${blockTitle}`))
  if (startIndex === -1) return null
  let endIndex = startIndex
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    const indentMatch = line.match(/^[\t ]+/)
    const isContinuation = Boolean(indentMatch) && line.slice(indentMatch[0].length).startsWith('>')
    if (!isContinuation || line.trim() === '') break
    endIndex = index
  }
  return { start: startIndex, end: endIndex }
}

/**
 * Toutes les occurrences du bloc dans la note, dans l'ordre. Chaque
 * recherche repart juste après la fin de la précédente : les plages ne se
 * chevauchent jamais.
 */
function findAllBlockRanges(lines, blockTitle) {
  const ranges = []
  let offset = 0
  while (offset <= lines.length) {
    const range = findBlockRange(lines.slice(offset), blockTitle)
    if (!range) break
    ranges.push({ start: range.start + offset, end: range.end + offset })
    offset += range.end + 1
  }
  return ranges
}

/** Position d'insertion : après le frontmatter s'il existe, sinon en tête. */
function insertionPoint(lines) {
  if (lines[0] !== '---') return 0
  const closing = lines.indexOf('---', 1)
  return closing === -1 ? 0 : closing + 1
}

/**
 * Remplace le premier bloc trouvé par newBlock et supprime tout doublon
 * éventuel repéré plus loin dans la note (bloc résiduel d'une exécution
 * précédente, copier-coller accidentel…), sans toucher au contenu qui les
 * entoure. Si aucun bloc n'existe, insère newBlock après le frontmatter.
 */
function replaceBlock(content, blockTitle, newBlock) {
  const text = String(content || '')
  if (!text.trim()) return newBlock
  const lines = text.split('\n')
  const ranges = findAllBlockRanges(lines, blockTitle)
  if (ranges.length > 0) {
    for (let i = ranges.length - 1; i >= 1; i -= 1) {
      const { start, end } = ranges[i]
      lines.splice(start, end - start + 1)
    }
    const first = ranges[0]
    lines.splice(first.start, first.end - first.start + 1, ...newBlock.split('\n'))
    return lines.join('\n')
  }
  const at = insertionPoint(lines)
  lines.splice(at, 0, ...newBlock.split('\n'))
  return lines.join('\n')
}

// ─── commands.js ─────────────────────────────────────────────────

const NOM_PLUGIN = 'Agendas Nextcloud'
const DEFAULT_BLOCK_TITLE = '📅 Agendas partagés'

/**
 * Une valeur absente, vide ou non numérique doit retomber sur les 7 jours
 * par défaut, pas sur 1 jour : un champ vidé par inadvertance dans les
 * préférences ne doit pas réduire silencieusement la fenêtre à la seule
 * journée courante.
 */
function readDaysAhead(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue
  if (value === undefined || value === null || value === '') return 7
  const number = Number(value)
  if (!Number.isFinite(number)) return 7
  const rounded = Math.round(number)
  if (rounded < 1) return 1
  if (rounded > 31) return 31
  return rounded
}

function readConfig(settings) {
  const source = settings || {}
  const serverUrl = String(source.serverUrl || '').trim()
  const username = String(source.username || '').trim()
  const password = String(source.password || '').trim()
  if (!serverUrl) throw new Error('Racine WebDAV manquante : renseignez-la dans les préférences du plugin.')
  if (!username) throw new Error('Identifiant CalDAV manquant : renseignez-le dans les préférences du plugin.')
  if (!password) throw new Error('Mot de passe CalDAV manquant : renseignez-le dans les préférences du plugin.')

  const daysAhead = readDaysAhead(source.daysAhead)

  return {
    serverUrl,
    username,
    password,
    daysAhead,
    blockTitle: String(source.blockTitle || '').trim() || DEFAULT_BLOCK_TITLE,
    calendars: Array.isArray(source.calendars) ? source.calendars : [],
  }
}

/**
 * Clé du jour calendaire (Paris) précédant celui de `date`. Passe par
 * parisMidnight + une marge d'une demi-journée (comme dayList) plutôt que par
 * une simple soustraction de 24h, pour rester correct autour des changements
 * d'heure d'été/hiver.
 */
function previousDayKey(date) {
  const midnight = parisMidnight(date)
  return dateKey(new Date(midnight.getTime() - DAY_MS / 2))
}

/**
 * Dernier jour (clé Paris) couvert par un événement.
 * - Pas de fin : seul le jour de début est occupé.
 * - Journée entière : DTEND ICS est EXCLUSIVE, le dernier jour affiché est
 *   donc la veille de la date de fin.
 * - Horaire finissant à minuit pile (Paris) : le jour de fin n'est pas
 *   occupé, l'événement s'arrête avant qu'il ne commence.
 * - Horaire finissant à toute autre heure : le jour de fin est occupé.
 */
function lastCoveredDayKey(event) {
  if (!event.end) return dateKey(event.start)
  if (event.allDay) return previousDayKey(event.end)
  const { hour, minute } = toParisParts(event.end)
  if (hour === 0 && minute === 0) return previousDayKey(event.end)
  return dateKey(event.end)
}

/**
 * La requête CalDAV retourne tout ce qui CHEVAUCHE la fenêtre : un événement
 * sur plusieurs jours doit donc être rangé dans CHACUN des jours de la
 * fenêtre qu'il couvre (bornés à `days`), pas seulement à son jour de début —
 * sans quoi un événement commencé avant la fenêtre et non terminé disparaît
 * purement et simplement.
 */
function groupEventsByDay(events, days) {
  const grouped = {}
  for (const day of days) grouped[dateKey(day)] = []
  for (const event of events) {
    if (!event.start) continue
    const startKey = dateKey(event.start)
    const endKey = lastCoveredDayKey(event)
    for (const day of days) {
      const key = dateKey(day)
      if (key >= startKey && key <= endKey) grouped[key].push(event)
    }
  }
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => (a.start ? a.start.getTime() : 0) - (b.start ? b.start.getTime() : 0))
  }
  return grouped
}

/**
 * Lundis TT : visibles même au-delà du jour traité, c'est tout leur intérêt.
 * La déduplication se fait sur le RÉSUMÉ des événements déjà présents ce
 * jour-là, pas sur les lignes déjà formatées (qui portent l'heure en préfixe
 * et ne peuvent donc jamais correspondre au résumé brut).
 */
function buildEntriesForDay(dayKey, perCalendar) {
  return perCalendar.map((calendar) => {
    if (calendar.error) {
      return { label: calendar.label, lines: [`⚠️ ${flattenWhitespace(calendar.error)}`] }
    }
    const dayEvents = calendar.grouped[dayKey] || []
    const daySummaries = new Set(dayEvents.map((event) => flattenWhitespace(event.summary)))
    const lines = dayEvents.map(formatEventLine)
    const mondays = calendar.events
      .filter((event) => isMondayTT(event.summary))
      .map((event) => flattenWhitespace(event.summary))
    for (const monday of mondays) {
      if (!daySummaries.has(monday)) lines.push(monday)
    }
    return { label: calendar.label, lines }
  })
}

/** Messages d'erreur distincts, dans l'ordre de première apparition. */
function distinctErrors(perCalendar) {
  const messages = []
  for (const calendar of perCalendar) {
    const message = calendar.error || 'cause inconnue'
    if (!messages.includes(message)) messages.push(message)
  }
  return messages
}

/**
 * La fenêtre réseau couvre toujours config.daysAhead, même quand on ne rend
 * qu'un seul jour (bloc du jour) : les Lundis TT doivent être vus à l'avance.
 */
async function collect(config, days) {
  const { from, to } = windowBounds(days[0], config.daysAhead)
  const perCalendar = []
  for (const calendar of config.calendars) {
    try {
      const events = await fetchEvents(config, calendar.href, from, to)
      perCalendar.push({
        label: calendar.label,
        events,
        grouped: groupEventsByDay(events, days),
      })
    } catch (error) {
      perCalendar.push({
        label: calendar.label,
        events: [],
        grouped: {},
        error: error && error.message ? error.message : String(error),
      })
    }
  }
  return perCalendar
}

/**
 * Vrai si `note` est celle actuellement ouverte dans l'éditeur (comparaison
 * par nom de fichier). Défensif par construction : Editor peut être absent de
 * l'environnement, sa note peut être nulle, toute anomalie retombe sur false
 * plutôt que d'interrompre l'écriture.
 */
function isNoteOpenInEditor(note) {
  try {
    if (!note || typeof Editor === 'undefined' || !Editor || !Editor.note) return false
    return Editor.note.filename === note.filename
  } catch (error) {
    return false
  }
}

/**
 * Écrit le bloc dans la note du jour `key`, en gérant la note absente.
 * Cascade prévue par la spécification : essayer d'obtenir la note ; si
 * absente, la créer via l'URL de rappel PUIS RETENTER de l'obtenir ; si elle
 * reste introuvable, le jour est considéré non traité (retourne false) sans
 * lever d'exception, pour ne pas interrompre le traitement des autres jours.
 *
 * NotePlan.openURL ne garantit pas que son rejet signifie un échec réel de la
 * création (le catch peut ne jamais se déclencher en pratique) : on ignore
 * son issue et on se fie uniquement à la nouvelle lecture de la note.
 *
 * Si la note visée est celle actuellement ouverte dans l'éditeur, l'écriture
 * passe par Editor plutôt que par l'objet note : NotePlan gère alors deux
 * tampons distincts, et écrire dans le mauvais perd soit la mise à jour du
 * plugin, soit la saisie en cours de l'utilisateur.
 */
async function writeDayNote(key, block, blockTitle) {
  let note = DataStore.calendarNoteByDateString(key)
  if (!note) {
    const url =
      'noteplan://x-callback-url/addText?noteDate=' + key +
      '&mode=prepend&openNote=no&text=' + encodeURIComponent(`${block}\n`)
    try {
      await NotePlan.openURL(url)
    } catch (error) {
      // ignoré volontairement : la vérification se fait juste après par relecture
    }
    note = DataStore.calendarNoteByDateString(key)
  }
  if (!note) return false
  if (isNoteOpenInEditor(note)) {
    Editor.content = replaceBlock(Editor.content || '', blockTitle, block)
  } else {
    note.content = replaceBlock(note.content || '', blockTitle, block)
  }
  return true
}

async function agendaRafraichir() {
  let config
  try {
    config = readConfig(DataStore.settings)
  } catch (error) {
    await CommandBar.prompt(NOM_PLUGIN, error.message)
    return
  }
  if (!config.calendars.length) {
    await CommandBar.prompt(
      NOM_PLUGIN,
      'Aucun calendrier suivi. Lancez d’abord « Agendas Nextcloud : choisir les calendriers ».',
    )
    return
  }

  const days = dayList(new Date(), config.daysAhead)
  const perCalendar = await collect(config, days)

  const allFailed = perCalendar.every((calendar) => calendar.error)
  if (allFailed) {
    const messages = distinctErrors(perCalendar)
    await CommandBar.prompt(
      `${NOM_PLUGIN} — échec`,
      `Aucun calendrier n’a répondu, aucune note n’a été modifiée.\n\n${messages.join('\n')}`,
    )
    return
  }

  let written = 0
  const failedDays = []
  for (const day of days) {
    const key = dateKey(day)
    const block = buildDayBlock({
      date: day,
      blockTitle: config.blockTitle,
      entries: buildEntriesForDay(key, perCalendar),
    })
    let ok
    try {
      ok = await writeDayNote(key, block, config.blockTitle)
    } catch (error) {
      ok = false
    }
    if (ok) written += 1
    else failedDays.push(key)
  }

  const errors = perCalendar.filter((calendar) => calendar.error).length
  const total = perCalendar.reduce((sum, calendar) => sum + calendar.events.length, 0)
  const parts = [`${written} jour(s) mis à jour`, `${total} événement(s)`]
  if (errors) parts.push(`${errors} calendrier(s) en erreur`)
  if (failedDays.length) parts.push(`jours non traités : ${failedDays.join(', ')}`)
  await CommandBar.prompt(NOM_PLUGIN, parts.join(' — '))
}

async function agendaBlocDuJour() {
  let config
  try {
    config = readConfig(DataStore.settings)
  } catch (error) {
    return `**${NOM_PLUGIN} indisponible** : ${error.message}`
  }
  if (!config.calendars.length) return `**${NOM_PLUGIN}** : aucun calendrier suivi.`

  const days = dayList(new Date(), 1)
  try {
    const perCalendar = await collect(config, days)
    return buildDayBlock({
      date: days[0],
      blockTitle: config.blockTitle,
      entries: buildEntriesForDay(dateKey(days[0]), perCalendar),
    })
  } catch (error) {
    return `**${NOM_PLUGIN} indisponible** : ${error && error.message ? error.message : error}`
  }
}

async function agendaChoisirCalendriers() {
  let config
  try {
    config = readConfig(DataStore.settings)
  } catch (error) {
    await CommandBar.prompt(NOM_PLUGIN, error.message)
    return
  }

  let available
  try {
    available = await discoverCalendars(config)
  } catch (error) {
    await CommandBar.prompt(`${NOM_PLUGIN} — découverte impossible`, error.message)
    return
  }
  if (!available.length) {
    await CommandBar.prompt(NOM_PLUGIN, 'Aucun calendrier trouvé sur le serveur.')
    return
  }

  const selected = new Map()
  for (const calendar of config.calendars) selected.set(calendar.href, calendar)

  // Étiquettes connues avant toute manipulation : un décoche/recoche dans la
  // même session doit retrouver l'étiquette personnalisée, pas la redéduire.
  const knownLabels = new Map()
  for (const calendar of config.calendars) knownLabels.set(calendar.href, calendar.label)

  // showOptions ne rend qu'un choix : on boucle jusqu'à « Terminer ».
  for (;;) {
    const options = ['✓ Terminer la sélection'].concat(
      available.map((calendar) => `${selected.has(calendar.href) ? '● ' : '   '}${calendar.displayName}`),
    )
    const choice = await CommandBar.showOptions(options, 'Calendriers à suivre')
    if (!choice || choice.index === undefined || choice.index <= 0) break
    const calendar = available[choice.index - 1]
    if (selected.has(calendar.href)) {
      selected.delete(calendar.href)
    } else {
      selected.set(calendar.href, {
        href: calendar.href,
        displayName: calendar.displayName,
        label: knownLabels.has(calendar.href) ? knownLabels.get(calendar.href) : guessLabel(calendar.displayName),
      })
    }
  }

  const chosen = Array.from(selected.values())
  for (const calendar of chosen) {
    const answer = await CommandBar.textPrompt(
      'Étiquette',
      `Étiquette pour « ${calendar.displayName} »`,
      calendar.label,
    )
    if (answer) calendar.label = String(answer).trim()
  }

  DataStore.settings = Object.assign({}, DataStore.settings, { calendars: chosen })
  await CommandBar.prompt(
    NOM_PLUGIN,
    chosen.length
      ? `${chosen.length} calendrier(s) suivi(s) : ${chosen.map((c) => c.label).join(', ')}`
      : 'Aucun calendrier suivi.',
  )
}
