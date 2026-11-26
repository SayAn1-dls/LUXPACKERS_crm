/* Departments and registers. Every page of the CRM is built from these lists. */
(function () {
  const TASK_STATUS = [
    { v: "To do", tone: "todo", hint: "Has to be done. Nobody has started yet." },
    { v: "In progress", tone: "doing", hint: "Someone is working on it now." },
    { v: "To be given", tone: "wait", hint: "Waiting for someone to hand something over: a price, dates, photos, a login or a decision." },
    { v: "Not done", tone: "alert", hint: "Late or blocked. Write the reason in the notes." },
    { v: "Done", tone: "done", hint: "Finished and checked." }
  ];

  const DEPARTMENTS = [
    { id: "management", name: "Management", lead: "CEO", about: "Direction, approvals and the weekly review.", registers: ["tasks"] },
    { id: "sales", name: "Sales & Reservations", lead: "Sales lead", about: "Enquiries, quotes, follow-ups and confirmed guests.", registers: ["leads", "bookings"] },
    { id: "operations", name: "Operations", lead: "Operations lead", about: "Hotels, ground partners, transfers and guests on the road.", registers: ["bookings", "partners"] },
    { id: "product", name: "Trips & Content", lead: "Content lead", about: "Itineraries, destinations and everything published on the website.", registers: ["trips"] },
    { id: "marketing", name: "Marketing", lead: "Marketing lead", about: "Instagram, reviews, stories and campaigns.", registers: ["content"] },
    { id: "finance", name: "Finance", lead: "CFO", about: "Prices, payments in and out, taxes and refunds.", registers: ["finance", "bookings"] },
    { id: "technology", name: "Technology", lead: "CTO", about: "Website, admin dashboard, hosting and who holds which login.", registers: ["access"] },
    { id: "people", name: "People & Interns", lead: "CEO", about: "The team, interns, onboarding and applications.", registers: ["team"] }
  ];
  const DEPT_NAMES = DEPARTMENTS.map(d => d.name);
  const deptField = { key: "dept", label: "Department", type: "select", options: DEPT_NAMES, required: true };
  const owner = { key: "owner", label: "Owner", type: "person" };
  const links = { key: "links", label: "Links", type: "links", wide: true, help: "Add the page where the work happens: a dashboard page, a Google Drive folder, a quote, a contract." };
  const notes = { key: "notes", label: "Notes", type: "textarea", wide: true };

  const MODULES = [
    {
      id: "tasks", name: "Tasks", singular: "task", dept: null,
      intro: "Every job in the company, each with one owner, one due date and one status.",
      titleKey: "title", statusKey: "status", statuses: TASK_STATUS,
      columns: ["title", "dept", "owner", "due", "priority", "status", "links"],
      filters: ["dept", "owner", "priority"],
      fields: [
        { key: "title", label: "Task", type: "text", required: true, wide: true },
        deptField, owner,
        { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] },
        { key: "status", label: "Status", type: "status" },
        { key: "due", label: "Due date", type: "date" },
        { key: "givenBy", label: "Waiting on", type: "text", placeholder: "Who must hand something over?", showIf: r => r.status === "To be given" },
        links, notes
      ],
      dueKey: "due", doneValues: ["Done"]
    },
    {
      id: "leads", name: "Enquiries", singular: "enquiry", dept: "Sales & Reservations",
      intro: "Every traveller who has asked about a trip, from first message to confirmation.",
      titleKey: "name", statusKey: "stage",
      statuses: [
        { v: "New enquiry", tone: "todo" }, { v: "Contacted", tone: "doing" }, { v: "Quote sent", tone: "doing" },
        { v: "Negotiating", tone: "wait" }, { v: "Confirmed", tone: "done" }, { v: "Lost", tone: "muted" }
      ],
      columns: ["name", "destination", "travelDate", "pax", "quote", "followUp", "owner", "stage"],
      filters: ["owner", "source"],
      fields: [
        { key: "name", label: "Traveller name", type: "text", required: true },
        { key: "phone", label: "Phone / WhatsApp", type: "text" },
        { key: "email", label: "Email", type: "email" },
        { key: "destination", label: "Destination or trip", type: "text" },
        { key: "travelDate", label: "Travel date", type: "date" },
        { key: "pax", label: "Travellers", type: "number" },
        { key: "budget", label: "Budget (₹)", type: "money" },
        { key: "quote", label: "Quote value (₹)", type: "money" },
        { key: "source", label: "Came from", type: "select", options: ["Website", "Instagram", "WhatsApp", "Phone call", "Referral", "Returning guest", "Other"] },
        { key: "stage", label: "Stage", type: "status" },
        owner,
        { key: "followUp", label: "Next follow-up", type: "date" },
        links, notes
      ],
      dueKey: "followUp", doneValues: ["Confirmed", "Lost"]
    },
    {
      id: "bookings", name: "Bookings", singular: "booking", dept: "Operations",
      intro: "Confirmed guests: payment received, documents, vouchers and the trip itself.",
      titleKey: "guest", statusKey: "payStatus",
      statuses: [
        { v: "Token paid", tone: "wait" }, { v: "Part paid", tone: "doing" }, { v: "Fully paid", tone: "done" },
        { v: "Refund due", tone: "alert" }, { v: "Cancelled", tone: "muted" }
      ],
      columns: ["ref", "guest", "trip", "start", "value", "balance", "tripStatus", "payStatus"],
      filters: ["owner", "tripStatus"],
      fields: [
        { key: "ref", label: "Booking reference", type: "text" },
        { key: "guest", label: "Lead guest", type: "text", required: true },
        { key: "phone", label: "Phone / WhatsApp", type: "text" },
        { key: "trip", label: "Trip", type: "text" },
        { key: "start", label: "Travel starts", type: "date" },
        { key: "end", label: "Travel ends", type: "date" },
        { key: "pax", label: "Travellers", type: "number" },
        { key: "value", label: "Package value (₹)", type: "money" },
        { key: "received", label: "Received so far (₹)", type: "money" },
        { key: "balance", label: "Balance (₹)", type: "computed", calc: r => (Number(r.value) || 0) - (Number(r.received) || 0), format: "money" },
        { key: "payStatus", label: "Payment", type: "status" },
        { key: "tripStatus", label: "Trip status", type: "select", options: ["Documents pending", "Vouchers sent", "Travelling now", "Completed"] },
        owner, links, notes
      ],
      dueKey: "start", doneValues: ["Fully paid", "Cancelled"]
    },
    {
      id: "trips", name: "Trips", singular: "trip", dept: "Trips & Content",
      intro: "Each itinerary on its way from the first draft to live on luxpackers.com.",
      titleKey: "name", statusKey: "status",
      statuses: [
        { v: "In preparation", tone: "doing" }, { v: "Ready to publish", tone: "wait" },
        { v: "Live", tone: "done" }, { v: "Paused", tone: "muted" }
      ],
      columns: ["name", "destination", "kind", "duration", "steps", "owner", "status"],
      filters: ["kind", "owner"],
      fields: [
        { key: "name", label: "Trip name", type: "text", required: true, wide: true },
        { key: "destination", label: "Destination", type: "text" },
        { key: "kind", label: "Type", type: "select", options: ["Private", "Group"] },
        { key: "duration", label: "Duration", type: "text", placeholder: "7 days / 6 nights" },
        { key: "price", label: "Price per person (₹)", type: "money" },
        { key: "status", label: "Status", type: "status" },
        owner,
        { key: "steps", label: "Steps finished", type: "checklist", wide: true,
          options: ["Itinerary ready", "Destination added", "Entered in dashboard", "Photos ready", "Price set", "Batches added", "Live on website"] },
        links, notes
      ],
      doneValues: ["Live"]
    },
    {
      id: "finance", name: "Finance ledger", singular: "entry", dept: "Finance",
      intro: "Money in and money out, with what is still pending.",
      titleKey: "entry", statusKey: "status",
      statuses: [{ v: "Pending", tone: "wait" }, { v: "Paid", tone: "done" }, { v: "Overdue", tone: "alert" }, { v: "Cancelled", tone: "muted" }],
      columns: ["date", "entry", "flow", "category", "party", "amount", "status"],
      filters: ["flow", "category"],
      fields: [
        { key: "entry", label: "Description", type: "text", required: true, wide: true },
        { key: "flow", label: "Money", type: "select", options: ["In", "Out"], required: true },
        { key: "category", label: "Category", type: "select", options: ["Booking payment", "Supplier payment", "Refund", "Salary & stipend", "Marketing", "Software & hosting", "Taxes", "Other"] },
        { key: "party", label: "From / to", type: "text" },
        { key: "amount", label: "Amount (₹)", type: "money", required: true },
        { key: "date", label: "Date", type: "date" },
        { key: "status", label: "Status", type: "status" },
        { key: "reference", label: "Invoice or transaction ref.", type: "text" },
        owner, links, notes
      ],
      dueKey: "date", doneValues: ["Paid", "Cancelled"]
    },
    {
      id: "partners", name: "Partners", singular: "partner", dept: "Operations",
      intro: "Hotels, ground partners, transport and activity suppliers we work with.",
      titleKey: "name", statusKey: "status",
      statuses: [{ v: "Active", tone: "done" }, { v: "Proposed", tone: "wait" }, { v: "On hold", tone: "muted" }],
      columns: ["name", "kind", "destination", "contact", "rating", "owner", "status"],
      filters: ["kind", "destination"],
      fields: [
        { key: "name", label: "Partner name", type: "text", required: true, wide: true },
        { key: "kind", label: "Type", type: "select", options: ["Hotel", "Ground partner", "Transport", "Activity", "Visa & flights", "Other"] },
        { key: "destination", label: "Destination", type: "text" },
        { key: "contact", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone / WhatsApp", type: "text" },
        { key: "email", label: "Email", type: "email" },
        { key: "rating", label: "Our rating", type: "select", options: ["5 · Excellent", "4 · Good", "3 · Fair", "2 · Poor", "1 · Avoid"] },
        { key: "status", label: "Status", type: "status" },
        owner, links, notes
      ],
      doneValues: []
    },
    {
      id: "content", name: "Content calendar", singular: "post", dept: "Marketing",
      intro: "Reels, posts, stories and campaigns, planned by date.",
      titleKey: "title", statusKey: "status",
      statuses: [{ v: "Idea", tone: "todo" }, { v: "In production", tone: "doing" }, { v: "Ready", tone: "wait" }, { v: "Published", tone: "done" }],
      columns: ["date", "title", "platform", "topic", "owner", "status", "links"],
      filters: ["platform", "owner"],
      fields: [
        { key: "title", label: "Title", type: "text", required: true, wide: true },
        { key: "platform", label: "Platform", type: "select", options: ["Instagram", "YouTube", "Website story", "WhatsApp", "Email", "Google Business"] },
        { key: "topic", label: "Trip or destination", type: "text" },
        { key: "date", label: "Publish date", type: "date" },
        { key: "status", label: "Status", type: "status" },
        owner, links, notes
      ],
      dueKey: "date", doneValues: ["Published"]
    },
    {
      id: "team", name: "Team", singular: "person", dept: "People & Interns",
      intro: "Everyone at Luxpackers. Names here appear in every Owner list.",
      titleKey: "name", statusKey: "status",
      statuses: [{ v: "Active", tone: "done" }, { v: "Onboarding", tone: "doing" }, { v: "Left", tone: "muted" }],
      columns: ["name", "role", "dept", "kind", "phone", "status"],
      filters: ["dept", "kind"],
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "role", label: "Role", type: "text" },
        deptField,
        { key: "kind", label: "Type", type: "select", options: ["Full-time", "Intern", "Freelancer"] },
        { key: "phone", label: "Phone / WhatsApp", type: "text" },
        { key: "email", label: "Email", type: "email" },
        { key: "start", label: "Joined on", type: "date" },
        { key: "status", label: "Status", type: "status" },
        links, notes
      ],
      doneValues: []
    },
    {
      id: "access", name: "Access register", singular: "system", dept: "Technology",
      intro: "Who holds which login. Never write a password, OTP or key here.",
      titleKey: "system", statusKey: "status",
      statuses: [{ v: "To confirm", tone: "todo" }, { v: "To be given", tone: "wait" }, { v: "Given", tone: "done" }, { v: "Remove access", tone: "alert" }],
      columns: ["system", "purpose", "holder", "givenTo", "keptIn", "status", "links"],
      filters: ["holder"],
      fields: [
        { key: "system", label: "System", type: "text", required: true, wide: true },
        { key: "purpose", label: "What it is for", type: "text", wide: true },
        { key: "holder", label: "Who holds it", type: "text" },
        { key: "givenTo", label: "To be given to", type: "text" },
        { key: "keptIn", label: "Password kept in", type: "text", placeholder: "Company password manager" },
        { key: "status", label: "Status", type: "status" },
        links, notes
      ],
      doneValues: ["Given"]
    }
  ];

  window.LUX_SCHEMA = { DEPARTMENTS, MODULES, TASK_STATUS };
})();
