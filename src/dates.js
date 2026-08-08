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

module.exports = {
  TIMEZONE, DAY_MS, toParisParts, dateKey, isoDay, utcStamp,
  parisLocalFromParts, parisMidnight, windowBounds, dayList,
  formatFrenchDate, formatTime,
}
