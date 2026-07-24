// University of Dhaka reference data for the signup / profile / roster dropdowns.
// Halls live in the DB `hall` table (they are FK targets); departments and sessions
// are stable enums, kept here as the single source of truth for the <select>s.

// Admission sessions, newest first. Add the next one each year.
export const DU_SESSIONS = [
  "2025-26",
  "2024-25",
  "2023-24",
  "2022-23",
  "2021-22",
  "2020-21",
  "2019-20",
  "2018-19",
] as const;

// Departments & institutes across the University of Dhaka faculties. Grouped by
// faculty for the optgroup rendering; flatten with DU_DEPARTMENTS for validation.
export const DU_DEPARTMENT_GROUPS: { faculty: string; departments: string[] }[] = [
  {
    faculty: "Engineering & Technology",
    departments: [
      "Computer Science and Engineering",
      "Electrical and Electronic Engineering",
      "Applied Physics, Electronics and Communication Engineering",
      "Nuclear Engineering",
      "Robotics and Mechatronics Engineering",
      "Biomedical Engineering",
      "Institute of Information Technology",
    ],
  },
  {
    faculty: "Science",
    departments: [
      "Physics",
      "Chemistry",
      "Mathematics",
      "Statistics",
      "Applied Mathematics",
      "Theoretical Physics",
      "Biomedical Physics and Technology",
    ],
  },
  {
    faculty: "Biological Sciences",
    departments: [
      "Botany",
      "Zoology",
      "Biochemistry and Molecular Biology",
      "Microbiology",
      "Genetic Engineering and Biotechnology",
      "Soil, Water and Environment",
      "Fisheries",
      "Psychology",
      "Clinical Psychology",
      "Institute of Nutrition and Food Science",
    ],
  },
  {
    faculty: "Pharmacy",
    departments: [
      "Pharmaceutical Chemistry",
      "Pharmaceutical Technology",
      "Clinical Pharmacy and Pharmacology",
    ],
  },
  {
    faculty: "Earth & Environmental Sciences",
    departments: [
      "Geology",
      "Geography and Environment",
      "Oceanography",
      "Meteorology",
      "Disaster Science and Climate Resilience",
    ],
  },
  {
    faculty: "Business Studies",
    departments: [
      "Accounting and Information Systems",
      "Management",
      "Marketing",
      "Finance",
      "Banking and Insurance",
      "Management Information Systems",
      "International Business",
      "Organization Strategy and Leadership",
      "Tourism and Hospitality Management",
      "Institute of Business Administration",
    ],
  },
  {
    faculty: "Arts & Humanities",
    departments: [
      "Bangla",
      "English",
      "Arabic",
      "Persian Language and Literature",
      "Urdu",
      "Sanskrit",
      "Pali and Buddhist Studies",
      "History",
      "Islamic History and Culture",
      "Philosophy",
      "Islamic Studies",
      "Information Science and Library Management",
      "Linguistics",
      "Theatre and Performance Studies",
      "Music",
      "World Religions and Culture",
      "Dance",
    ],
  },
  {
    faculty: "Social Sciences",
    departments: [
      "Economics",
      "Political Science",
      "International Relations",
      "Sociology",
      "Public Administration",
      "Anthropology",
      "Population Sciences",
      "Peace and Conflict Studies",
      "Women and Gender Studies",
      "Development Studies",
      "Communication and Journalism",
      "Mass Communication and Journalism",
      "Printing and Publication Studies",
      "Criminology",
      "Japanese Studies",
    ],
  },
  {
    faculty: "Law",
    departments: ["Law", "Law and Land Management"],
  },
  {
    faculty: "Fine Arts",
    departments: [
      "Drawing and Painting",
      "Graphic Design",
      "Printmaking",
      "Oriental Art",
      "Ceramics",
      "Sculpture",
      "Craft",
      "History of Art",
    ],
  },
  {
    faculty: "Education",
    departments: [
      "Institute of Education and Research",
      "Health Economics",
      "Educational and Counselling Psychology",
    ],
  },
  {
    faculty: "Modern Languages",
    departments: ["Institute of Modern Languages"],
  },
];

// Flat list — used to validate a submitted department server-side.
export const DU_DEPARTMENTS: string[] = DU_DEPARTMENT_GROUPS.flatMap((g) => g.departments);

export function isValidSession(s: string): boolean {
  return (DU_SESSIONS as readonly string[]).includes(s);
}
export function isValidDepartment(d: string): boolean {
  return DU_DEPARTMENTS.includes(d);
}
