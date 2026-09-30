export const ATTENDANCE_PARSER_VERSION = "farm-attendance-v1";

function normalize(value) {
  return typeof value === "string" ? value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/\s+/g, " ").trim() : "";
}

const STAFF = /^(?:guida|guide|autista|autisti|driver|drivers)\b/;
const GUEST = /^(?:adulti?|adults?|bambin[oaie]|children|child|neonat[oi]|infants?|pax|persone)\b/;

// Consume only the initial people expression, never dietary notes, phone
// numbers, booking references or activity durations elsewhere in the title.
function peoplePrefix(text) {
  let rest = text;
  let observed = 0;
  let staff = 0;
  let terms = 0;
  for (;;) {
    const number = rest.match(/^\d+\b/);
    const count = number ? Number(number[0]) : 1;
    if (number) rest = rest.slice(number[0].length).trimStart();
    const role = rest.match(STAFF);
    const guest = rest.match(GUEST);
    if ((!number && !role) || !Number.isSafeInteger(count) || count > 2147483647) return null;
    if (role) {
      staff += count;
      rest = rest.slice(role[0].length).trimStart();
    } else if (guest) rest = rest.slice(guest[0].length).trimStart();
    observed += count;
    terms++;
    if (!rest.startsWith("+")) break;
    rest = rest.slice(1).trimStart();
  }
  if (observed > 2147483647 || /^[\d/+.,:-]/.test(rest) || /^(?:o|oppure|e|and|or)\s+\d/.test(rest)) return null;
  return { observed, staff, terms, rest };
}

/** Pure title evidence only. Staging adults/experience defaults are ignored.
 * observed includes explicitly counted staff; effective excludes staff.
 * A bare "con guida" describes the activity, not a guide included in the count.
 * Cancellation belongs to the separate status plan, not title attendance.
 */
export function parseGoogleCalendarAttendance(input) {
  const title = typeof input === "string" ? input : input?.original_title ?? input?.title ?? input?.summary;
  const text = normalize(title);
  const result = {
    observed_total_guests: null,
    effective_total_guests: null,
    excluded_staff: null,
    attendance_source: "google_title",
    attendance_quality: "needs_review",
    attendance_parser_version: ATTENDANCE_PARSER_VERSION,
    event_classification: "unclassified",
    exclusion_reason: null,
    activity: null,
    review_reasons: [],
  };
  if (/^tuscan\s+escape(?:\s+t|\s*-\s*blocco\s+data)?$/.test(text)) {
    return { ...result, effective_total_guests: 0, attendance_quality: "parsed",
      event_classification: "operational_block", exclusion_reason: "explicit_tuscan_escape_block", activity: "block" };
  }
  const people = peoplePrefix(text);
  if (people) {
    result.observed_total_guests = people.observed;
    result.excluded_staff = people.staff;
  }
  if (people && people.observed === people.staff && !people.rest) {
    return { ...result, effective_total_guests: 0, attendance_quality: "parsed", exclusion_reason: "staff_only" };
  }
  // Ignore parenthetical dietary annotations for activity recognition only.
  const activityText = text.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ");
  const ebike = /\be[ -]?bikes?\b/.test(activityText);
  const rental = ebike && /\b(?:solo noleggio|noleggio|rental only|only rental|rental)\b/.test(activityText);
  const guided = ebike && /\b(?:con guida|guidat[oaie]|guided)\b/.test(activityText);
  const meal = /\b(?:pranzo|lunch|farm visit|visita (?:in |alla )?fattoria|taglier[ei]|bruschett[ae]|cena|dinner|cooking(?: class)?|lezione di cucina)\b/.test(activityText);
  const farm = /\b(?:degustazione|picnic|pic nic|attivita|visita)\b.*\b(?:in fattoria|alla fattoria)\b/.test(activityText);
  if (rental && (guided || meal || farm)) result.review_reasons.push("conflicting_activity_evidence");
  else if (rental) {
    return { ...result, effective_total_guests: 0, attendance_quality: "parsed",
      event_classification: "customer_event", exclusion_reason: "offsite_rental_only", activity: "ebike_rental" };
  } else if (meal || farm || guided) {
    result.event_classification = "customer_event";
    result.activity = guided ? "ebike_guided" : /\bpranzo\b/.test(activityText) && /\btuscan escape\b/.test(activityText)
      ? "tuscan_escape_lunch" : "farm_activity";
    if (people) {
      let clients = people.observed - people.staff;
      if (result.activity === "tuscan_escape_lunch") {
        // Only the documented N-pranzo convention implies one included guide.
        // Explicit additions/roles require review instead of double subtraction.
        if (people.terms !== 1 || people.staff || people.observed < 1) result.review_reasons.push("ambiguous_tuscan_group");
        else { clients--; result.excluded_staff = 1; }
      }
      // A later staff/people arithmetic expression is not an initial group.
      const restWithoutPhones = people.rest.replace(/\+\d{1,3}(?:[\s().-]*\d){6,15}/g, "");
      if (/[+]\s*(?:\d|guida|guide|autista|driver)/.test(restWithoutPhones)
        || /\b(?:inclus[oaie]|compres[oaie])\b.*\b(?:guida|guide|autista|driver)\b/.test(people.rest)) {
        result.review_reasons.push("ambiguous_people_expression");
      }
      if (!result.review_reasons.length) {
        result.effective_total_guests = clients;
        result.attendance_quality = "parsed";
        if (clients === 0 && people.staff > 0) result.exclusion_reason = "staff_only";
      }
    } else result.review_reasons.push("missing_or_ambiguous_people_count");
  } else result.review_reasons.push(ebike ? "ebike_guidance_unknown" : "farm_activity_unproven");
  return result;
}
