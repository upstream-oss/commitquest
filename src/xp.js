import { normalizeEvents } from './activity.js'

const BASE_XP = {
    push: 10,
    pull_request_opened: 15,
    pull_request_merged: 50,
    pull_request_reviewed: 25,
    issue_opened: 10,
    issue_closed: 20
}

export function calculateXP(activity, options = {}) {
    if (Array.isArray(activity)) {
        activity = normalizeEvents(activity)
    }

    if (!activity || !Array.isArray(activity.records)) {
        throw new TypeError('Activity must contain a records array')
    }

    const today = options.today || utcDate(new Date())
    const streak = calculateCurrentStreak(activity.records, today)
    const multiplier = streakMultiplier(streak)
    const breakdown = emptyBreakdown()
    let totalXP = 0

    const seen = new Set()
    for (const record of activity.records) {
        if (!isValidRecord(record)) continue
        if (record.id && seen.has(`${record.source || ''}:${record.id}`)) continue
        if (record.id) seen.add(`${record.source || ''}:${record.id}`)

        const earned = BASE_XP[record.kind] * record.units * multiplier
        totalXP += earned
        breakdown[breakdownKey(record.kind)] += earned
    }

    return {
        totalXP: Math.round(totalXP),
        level: levelForXP(Math.round(totalXP)),
        streak,
        breakdown,
        coverage: activity.coverage
    }
}

function calculateCurrentStreak(records, today) {
    const pushDays = new Set(records
        .filter(record => isValidRecord(record) && record.kind === 'push')
        .map(record => record.occurredOn))

    if (!pushDays.has(today)) {
        const yesterday = shiftDate(today, -1)
        if (!pushDays.has(yesterday)) return 0
        today = yesterday
    }

    let streak = 0
    let date = today
    while (pushDays.has(date)) {
        streak++
        date = shiftDate(date, -1)
    }

    return streak
}

function isValidRecord(record) {
    return Boolean(
        record?.valid &&
        BASE_XP[record.kind] &&
        Number.isFinite(record.units) &&
        record.units > 0 &&
        isValidDate(record.occurredOn)
    )
}

function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function streakMultiplier(streak) {
    if (streak >= 30) return 3
    if (streak >= 14) return 2
    if (streak >= 7) return 1.5
    if (streak >= 3) return 1.25
    return 1
}

function levelForXP(totalXP) {
    let level = 1
    while (Math.round(100 * (level + 1) ** 1.5) <= totalXP) {
        level++
    }
    return level
}

function breakdownKey(kind) {
    return {
        push: 'commits',
        pull_request_opened: 'pullRequestsOpened',
        pull_request_merged: 'pullRequestsMerged',
        pull_request_reviewed: 'reviewsGiven',
        issue_opened: 'issuesOpened',
        issue_closed: 'issuesClosed'
    }[kind]
}

function emptyBreakdown() {
    return {
        commits: 0,
        pullRequestsOpened: 0,
        pullRequestsMerged: 0,
        reviewsGiven: 0,
        issuesOpened: 0,
        issuesClosed: 0
    }
}

function utcDate(value) {
    return value.toISOString().slice(0, 10)
}

function shiftDate(date, days) {
    const value = new Date(`${date}T00:00:00.000Z`)
    value.setUTCDate(value.getUTCDate() + days)
    return utcDate(value)
}
