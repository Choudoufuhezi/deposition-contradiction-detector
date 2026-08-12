const COMMON_BASE_SCORE = 50;

const ABSOLUTE_PATTERNS = [
  /\bnever\b/i,
  /\bno\b/i,
  /\bnone\b/i,
  /\ball\b/i,
  /\balways\b/i,
  /\bentire(?:ly)?\b/i,
  /\bexactly\b/i,
  /\bdefinitely\b/i,
  /\bdid(?:n't| not)\b/i,
  /\bwas(?:n't| not)\b/i,
];

const HEDGE_PATTERNS = [
  /\bmaybe\b/i,
  /\bmight\b/i,
  /\baround\b/i,
  /\babout\b/i,
  /\bapproximately\b/i,
  /\bi think\b/i,
  /\bi believe\b/i,
  /\bpossibly\b/i,
  /\bprobably\b/i,
  /\bsomething\b/i,
  /\bor so\b/i,
  /\bi (?:do not|don't) remember\b/i,
];

const BROAD_LOCATION_PATTERN =
  /\b(?:area|general area|part of town|vicinity|neighbou?rhood|nearby|region)\b/i;
const SPECIFIC_LOCATION_PATTERN =
  /\b(?:warehouse|building|office|room|house|store|address|facility|property)\b/i;

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export function calculateClassificationConfidence(finding) {
  const factors = [];
  const addFactor = (code, label, impact) => factors.push({ code, label, impact });

  addFactor(
    "COMMON_BASE",
    "All classifications use the same evidence-neutral starting score",
    COMMON_BASE_SCORE,
  );

  if (finding.evidence1.verified && finding.evidence2.verified) {
    addFactor(
      "BOTH_QUOTES_VERIFIED",
      "Both quotations exactly match their source transcripts",
      20,
    );
  }

  const completeCount = [finding.evidence1, finding.evidence2].filter(
    (evidence) => evidence.completeStatement,
  ).length;
  if (completeCount === 2) {
    addFactor("BOTH_STATEMENTS_COMPLETE", "Both quotations contain complete answers", 10);
  } else if (completeCount === 1) {
    addFactor("ONE_STATEMENT_COMPLETE", "Only one quotation contains a complete answer", 3);
  }

  const quote1 = finding.evidence1.quote;
  const quote2 = finding.evidence2.quote;
  const combinedQuotes = `${quote1}\n${quote2}`;
  const context1 = `${finding.evidence1.question || ""} ${quote1}`;
  const context2 = `${finding.evidence2.question || ""} ${quote2}`;
  const locationScopeDifference = hasLocationScopeDifference(context1, context2);

  if (finding.type === "DIRECT" && !locationScopeDifference) {
    const absoluteQuoteCount = [quote1, quote2].filter(hasAbsoluteLanguage).length;
    if (absoluteQuoteCount === 2) {
      addFactor(
        "ABSOLUTE_LANGUAGE_BOTH",
        "Both statements use explicit or absolute language",
        8,
      );
    } else if (absoluteQuoteCount === 1) {
      addFactor(
        "ABSOLUTE_LANGUAGE_ONE",
        "One statement uses explicit or absolute language",
        5,
      );
    }
  }

  const hedgeCount = countPatternMatches(combinedQuotes, HEDGE_PATTERNS);
  if (hedgeCount > 0) {
    const impact = -Math.min(hedgeCount * 4, 16);
    addFactor(
      "HEDGED_LANGUAGE",
      `${hedgeCount} distinct uncertainty ${hedgeCount === 1 ? "signal reduces" : "signals reduce"} linguistic clarity`,
      impact,
    );
  }

  applyTemporalFactor(finding, addFactor);
  applyDateFactor(finding, addFactor);

  if (locationScopeDifference) {
    if (finding.type === "FALSE_POSITIVE") {
      addFactor(
        "LOCATION_SCOPE_COMPATIBLE",
        "The evidence distinguishes a specific place from a broader area",
        10,
      );
    } else {
      addFactor(
        "LOCATION_SCOPE_MISMATCH",
        "A specific place and a broader area weaken a contradiction classification",
        -15,
      );
    }
  }

  if (finding.stability?.classificationConflict) {
    addFactor(
      "CLASSIFICATION_CONFLICT",
      "Duplicate model findings disagreed on the classification",
      -15,
    );
  } else if (finding.stability?.duplicateCount > 0) {
    addFactor(
      "DUPLICATE_FINDING",
      "The model returned the same evidence pair more than once",
      -3,
    );
  }

  const score = clamp(
    factors.reduce((total, factor) => total + factor.impact, 0),
    0,
    100,
  );

  return {
    score,
    level: score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW",
    factors,
  };
}

export function attachClassificationConfidence(findings) {
  return findings.map((finding) => ({
    ...finding,
    classificationConfidence: calculateClassificationConfidence(finding),
  }));
}

function hasAbsoluteLanguage(text) {
  return ABSOLUTE_PATTERNS.some((pattern) => pattern.test(text));
}

function countPatternMatches(text, patterns) {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function hasLocationScopeDifference(text1, text2) {
  return (
    (SPECIFIC_LOCATION_PATTERN.test(text1) && BROAD_LOCATION_PATTERN.test(text2)) ||
    (BROAD_LOCATION_PATTERN.test(text1) && SPECIFIC_LOCATION_PATTERN.test(text2))
  );
}

function applyTemporalFactor(finding, addFactor) {
  const times1 = extractTimes(finding.evidence1.quote);
  const times2 = extractTimes(finding.evidence2.quote);
  if (times1.length === 0 || times2.length === 0) return;

  const tolerance = Math.max(
    timeTolerance(finding.evidence1.quote),
    timeTolerance(finding.evidence2.quote),
  );
  const distance = minimumTimeDistance(times1, times2);
  const intervalOverlap =
    times1.length >= 2 &&
    times2.some((time) => time >= Math.min(...times1) && time <= Math.max(...times1));

  if (finding.type === "FALSE_POSITIVE" && distance <= tolerance) {
    addFactor(
      "TIME_WITHIN_TOLERANCE",
      `The stated times fall within the ${tolerance}-minute approximation window`,
      10,
    );
  } else if (finding.type === "DIRECT" && distance <= tolerance) {
    addFactor(
      "TIME_WITHIN_TOLERANCE_CONFLICT",
      `The stated times fall within the ${tolerance}-minute approximation window`,
      -15,
    );
  } else if (finding.type === "INFERENTIAL" && (intervalOverlap || distance > tolerance)) {
    addFactor(
      "TEMPORAL_INFERENCE_SUPPORTED",
      "The parsed timeline supports the inferential classification",
      8,
    );
  }
}

function extractTimes(text) {
  const matches = [];
  if (/\bmidnight\b/i.test(text)) matches.push(1440);

  const timePattern = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi;
  for (const match of text.matchAll(timePattern)) {
    matches.push(toMinutes(Number(match[1]), Number(match[2] || 0), match[3]));
  }

  const unqualifiedClockPattern = /\b(\d{1,2}):(\d{2})(?!\s*(?:a\.?m\.?|p\.?m\.?))/gi;
  for (const match of text.matchAll(unqualifiedClockPattern)) {
    matches.push(Number(match[1]) * 60 + Number(match[2]));
  }

  const qualifiedHourPattern =
    /\b(?:around|about|approximately|maybe)\s+(\d{1,2})(?::(\d{2}))?(?!\s*(?:a\.?m\.?|p\.?m\.?))/gi;
  for (const match of text.matchAll(qualifiedHourPattern)) {
    let hour = Number(match[1]);
    if (/\bmidnight\b/i.test(text) && hour >= 6 && hour <= 11) hour += 12;
    matches.push(hour * 60 + Number(match[2] || 0));
  }

  return [...new Set(matches)];
}

function toMinutes(hour, minute, meridiem) {
  const normalized = meridiem.toLowerCase().replaceAll(".", "");
  let adjustedHour = hour % 12;
  if (normalized === "pm") adjustedHour += 12;
  return adjustedHour * 60 + minute;
}

function timeTolerance(text) {
  if (/\b(?:maybe|might|i think)\b/i.test(text)) return 45;
  if (/\b(?:around|about|approximately)\b/i.test(text)) return 30;
  return 15;
}

function minimumTimeDistance(times1, times2) {
  return Math.min(
    ...times1.flatMap((time1) =>
      times2.map((time2) => {
        const rawDistance = Math.abs(time1 - time2);
        return Math.min(rawDistance, 1440 - rawDistance);
      }),
    ),
  );
}

function applyDateFactor(finding, addFactor) {
  const dates1 = extractDates(
    `${finding.evidence1.question || ""} ${finding.evidence1.quote}`,
  );
  const dates2 = extractDates(
    `${finding.evidence2.question || ""} ${finding.evidence2.quote}`,
  );
  if (dates1.length === 0 || dates2.length === 0) return;

  const sameDate = dates1.some((date) => dates2.includes(date));
  if (sameDate) {
    addFactor("SAME_EXPLICIT_DATE", "Both statements reference the same explicit date", 5);
  } else if (finding.type === "FALSE_POSITIVE") {
    addFactor(
      "DIFFERENT_EXPLICIT_DATES",
      "The statements reference different explicit dates",
      8,
    );
  } else {
    addFactor(
      "DATE_SCOPE_MISMATCH",
      "Different explicit dates weaken a contradiction classification",
      -12,
    );
  }
}

function extractDates(text) {
  const dates = [];
  const monthNames = Object.keys(MONTHS).join("|");
  const pattern = new RegExp(
    `\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}))?`,
    "gi",
  );
  for (const match of text.matchAll(pattern)) {
    dates.push(`${MONTHS[match[1].toLowerCase()]}-${Number(match[2])}-${match[3] || "*"}`);
  }
  return dates;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
