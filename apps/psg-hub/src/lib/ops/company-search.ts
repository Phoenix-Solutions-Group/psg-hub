export type CompanySearchRow = {
  name: string;
  phone: string | null;
  contact: string | null;
  status: string;
};

export function filterCompaniesByWord<T extends CompanySearchRow>(companies: T[], query: string): T[] {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return companies;

  return companies.filter((company) => {
    const haystack = [company.name, company.contact, company.phone, company.status]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
