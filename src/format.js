const { formatFrenchDate, formatTime } = require('./dates')

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

module.exports = { guessLabel, initialsOf, isMondayTT, flattenWhitespace, formatEventLine, buildDayBlock }
