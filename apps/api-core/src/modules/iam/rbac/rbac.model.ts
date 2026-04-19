/**
 * Casbin RBAC model (inline). When policies grow we'll promote this to a
 * .conf file on disk; for MVP the policy fits in a small constant.
 *
 * Subjects: student | teacher | admin | ai_engine
 * Objects:  a URL-path-ish string (e.g. "courses", "courses:publish")
 * Actions:  read | write | delete | execute
 */
export const RBAC_MODEL = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && keyMatch(r.obj, p.obj) && (r.act == p.act || p.act == "*")
`.trim();

export const RBAC_POLICY: Array<[string, string, string]> = [
  // student
  ['student', 'me',                  'read'],
  ['student', 'courses',             'read'],
  ['student', 'courses:*',           'read'],
  ['student', 'courses:*:lessons',   'read'],
  ['student', 'enrollments',         'write'],
  ['student', 'me:enrollments',      'read'],
  ['student', 'submissions',         'write'],

  // teacher — inherits from student (see groupings) + authoring abilities
  ['teacher', 'teacher:courses',     'write'],
  ['teacher', 'teacher:courses:*',   'write'],
  ['teacher', 'courses:*:publish',   'write'],

  // admin — everything
  ['admin', '*', '*'],

  // ai_engine — strictly read-only on specific resources
  ['ai_engine', 'logs',      'read'],
  ['ai_engine', 'testcases', 'read'],
];

export const RBAC_GROUPINGS: Array<[string, string]> = [
  ['teacher', 'student'], // teachers can do anything students can
];
