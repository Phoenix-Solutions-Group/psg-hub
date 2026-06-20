export const MASTER_HEADER_MAPPINGS: Record<string, string[]> = {
  BUName: ["Repair Facility", "Location", "SHOP NAME", "Shop Name", "Shop", "Facility"],
  BusinessKeyPSG: ["Shop ID", "ShopID", "PSGID", "PSG ID"],
  RONumber: [
    "RO Number", "Shop Repair/Reference Number", "Shop R.O./Reference Number",
    "RO Number(s)", "RO      number", "RO#", "RO NUMBER", "RO", "Repair Order",
  ],
  EstimatorName: [
    "Estimator", "Shop CSR/Rep/Writer", "Estimator ID",
    "ESTIMATOR FIRST/LAST", "WRITER", "Writer",
  ],
  OwnerCompanyName: [
    "Company Name", "Company Name (if company vehicle)", "COMPANY NAME (FLEET)",
    "Company", "Fleet Name",
  ],
  OwnerFName: [
    "First Name", "Customer FIRST Name", "Name: First", "Owner First Name",
    "*Name: First:", "FIRST", "CUSTOMER FIRST NAME",
  ],
  OwnerLName: [
    "Last Name", "Customer LAST Name", "Name: Last", "Owner Last Name",
    "*Name: Last:", "LAST", "CUSTOMER LAST NAME",
  ],
  OwnerAddress1: [
    "Address 1", "Address", "Owner Street Address", "CUSTOMER ADDRESS",
    "*Address A:", "ADDRESS",
  ],
  OwnerAddress2: [
    "Address 2", "Owner Street Address2", "CUSTOMER ADDRESS 2", "*Address B:",
  ],
  OwnerCity: ["City", "Owner City", "CUSTOMER CITY", "*City:", "CITY"],
  OwnerStateProvince: ["State", "Owner State", "CUSTOMER STATE", "*State", "ST"],
  OwnerPostalZip: [
    "zip", "Zip", "Owner Zip", "CUSTOMER ZIP", "*Zip code", "Zip code", "ZIP",
  ],
  OwnerCellPhone: [
    "Best Phone Number", "Second Best Phone Number", "Cell Phone",
    "Owner Primary Phone", "CUSTOMER CONTACT",
    "Phone: (area code required)", "PHONE", "Phone",
  ],
  OwnerOtherPhone: ["Other Telephone", "Owner Secondary Phone"],
  OwnerDayPhone: ["Daytime Telephone"],
  OwnerWorkPhone: ["Work Phone", "Work Telephone"],
  OwnerHomePhone: ["Home Phone", "Home Telephone"],
  OwnerEmail: ["Owner Email", "Email", "Email Address", "EMAIL", "E-Mail"],
  VehicleYear: [
    "Year", "Vehicle Year", "Vehicle Year:", "*Vehicle year:",
    "VEHICLE YEAR", "YEAR",
  ],
  VehicleMake: ["Make", "Vehicle Make", "*Make", "VEHICLE MAKE"],
  VehicleModel: ["Model", "Vehicle Model", "*Model", "VEHICLE MODEL"],
  VehicleArrivedDate: [
    "In Date", "Vehicle In", "Repair In Date", "Repair In Date:",
    "IN", "VEHICLE IN DATE",
  ],
  DeliveredDate: [
    "Out Date", "Vehicle Out", "Repair Out Date", "Repair Completion Date",
    "*Repair completion date", "VEHICLE OUT DATE",
  ],
  GrossAmount: [
    "Total", "Repair Total", "Repair Total: $", "Estimate $",
    "*Repair Total", "REPAIR TOTAL", "SALE",
  ],
  InsuranceCompany: [
    "Company", "Insurance Company", "Insurance Company (paying for repair)",
    "*Insurance Company", "INSURANCE COMPANY",
  ],
  ClaimType: [
    "PayBy", "Insured/Claimant", "Customer Insurance", "Claimant",
    "Customer Pay", "Third Party", "*Pay Type", "PAYER", "PAYMENT TYPE",
  ],
  ReferralSourceName: [
    "Referral Source", "Referral Person", "Referral Dealership", "Referral From",
    "Referral From / How did you hear about us", "Primary Referral",
    "Secondary Referral", "REFERRED BY",
  ],
  BodyTechFullName: ["Body Technician", "BODY TECH FIRST/LAST", "TECHNICIAN"],
  PaintTechFullName: ["Paint Technician", "PAINTER FIRST/LAST"],
  InsuranceAgentName: [
    "Insurance Agent", "Insurance Agent Name",
    "Insurance Agent Name/Address/Phone", "INSURANCE AGENT NAME",
  ],
  Total_Loss: ["Total_Loss", "Total Loss"],
  SourceFeed: ["Source", "Source Feed"],
  RepeatCustomer: ["Repeat Customer", "Repeat"],
  DateOfBirth: ["Date of Birth", "DOB", "Birthday"],
  DriversLicenseExpiration: ["Drivers License Expiration", "DL Expiration"],
  OwnerCompanyName2: ["Company Name 2"],
};
