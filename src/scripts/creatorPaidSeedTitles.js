export const LEGACY_PAID_TOPICS = {
  Psychology: ["A Practical Reset for Overthinking", "Boundaries Without Guilt", "The Five-Minute Emotional Check-In"],
  Lifestyle: ["Design a Calmer Morning", "A Weekly Reset That Actually Fits", "Make Space for What Matters"],
  Fashion: ["Build a Signature Look", "Camera-Ready Styling Fundamentals", "A Versatile Capsule Wardrobe"],
  Finance: ["A Simple Monthly Money System", "Build Your First Safety Fund", "Spend With More Intention"],
  Business: ["A Simple Monthly Money System", "Build a Profitable Weekly Workflow", "Price Your Work With Confidence"],
  Tech: ["Use AI Without Losing Your Voice", "Automate One Repetitive Task", "Build a Reliable Personal Tech Stack"],
  Fitness: ["The Stronger Week Blueprint", "Mobility for Real Life", "Train Consistently Without Burnout"],
  Wellness: ["A Seven-Day Energy Reset", "Rest Without Falling Behind", "Build a Sustainable Self-Care Rhythm"],
};

export const PAID_SEED_SOURCE = "approved-creator-paid-seens-v1";

export const CREATOR_PAID_TOPICS = {
  "maya@gmail.com": ["A Practical Reset for Overthinking", "Boundaries Without Guilt", "The Five-Minute Emotional Check-In"],
  "noah@gmail.com": ["Design a Calmer Morning", "A Weekly Reset That Actually Fits", "Make Space for What Matters"],
  "sofia@gmail.com": ["The Essentials of Personal Styling", "Camera-Ready Styling Fundamentals", "A Versatile Capsule Wardrobe"],
  "oliver@gmail.com": ["A Simple Monthly Money System", "Build Your First Safety Fund", "Spend With More Intention"],
  "aisha@gmail.com": ["Use AI Without Losing Your Voice", "Automate One Repetitive Task", "Build a Reliable Personal Tech Stack"],
  "liam@gmail.com": ["The Stronger Week Blueprint", "Mobility for Real Life", "Train Consistently Without Burnout"],
  "priya@gmail.com": ["A Seven-Day Energy Reset", "Rest Without Falling Behind", "Build a Sustainable Self-Care Rhythm"],
  "lucas@gmail.com": ["Turn Your Creative Skill Into a Service", "Build a Profitable Weekly Workflow", "Price Your Work With Confidence"],
  "amara@gmail.com": ["A Home Routine for Busy Evenings", "Plan a Weekend That Restores You", "Small Rituals for a Fuller Day"],
  "kenji@gmail.com": ["A Desk-to-Dojo Mobility Reset", "Better Hips Through Everyday Movement", "Recover Between Strength Sessions"],
  "elena@gmail.com": ["Understand Your Stress Signals", "A Grounding Practice for Difficult Days", "Build Emotional Flexibility"],
  "marcus@gmail.com": ["An Evening Routine You Can Keep", "Clear the Clutter One Room at a Time", "Make Time for What Recharges You"],
  "zara@gmail.com": ["Style One Piece Three Ways", "Find the Colours That Work for You", "Make Your Wardrobe Work Harder"],
  "daniel@gmail.com": ["Validate an Idea Before You Build", "Your First Customer Interview", "Make a Simple Launch Plan"],
  "nia@gmail.com": ["Build Your First Useful AI Assistant", "A No-Code Workflow for Your Team", "Check AI Output Before You Share It"],
  "rafael@gmail.com": ["Build Strength With Bodyweight Basics", "A Practical Guide to Training Tempo", "Progress Without Adding More Gym Days"],
  "chloe@gmail.com": ["Recognise the Patterns in Your Relationships", "Repair a Conversation After Conflict", "Practise Emotional Safety Every Day"],
  "arjun@gmail.com": ["Build a Routine Around Your Commute", "A Better Lunch Break", "Switch Off After a Busy Workday"],
  "hana@gmail.com": ["Layering for a Changing Season", "Choose Fabrics That Last", "A Thoughtful Guide to Everyday Accessories"],
  "victor@gmail.com": ["Prototype Your First Digital Product", "Choose Tools for a Small Team", "A Practical Personal Data Backup Plan"],
};

export function creatorPaidTitle(email, index) {
  const title = CREATOR_PAID_TOPICS[String(email).toLowerCase()]?.[index];
  if (!title) throw new Error(`Missing creator-specific paid Seen title: ${email}, index ${index}`);
  return title;
}

// Produce a field-level repair only for unchanged, explicitly tagged seed data.
export function paidSeedTitleRepair(publication, { oldTitle, title, firstName, foundation = false }) {
  const source = foundation ? "client-showcase-v1" : PAID_SEED_SOURCE;
  const kind = foundation ? "EXPERIENCE" : "SEEN";
  if (foundation && !/^(Psychology|Lifestyle|Fashion|Finance|Business|Tech|Fitness|Wellness) Foundations$/.test(oldTitle)) return null;
  if (publication.seedSource !== source || publication.kind !== kind || publication.title !== oldTitle || title === oldTitle) return null;
  for (const key of ["submittedSnapshot", "publishedSnapshot"]) {
    if (publication[key]?.metadata?.title && publication[key].metadata.title !== oldTitle) return null;
  }
  const oldSummary = `A focused premium guide to ${oldTitle.toLowerCase()}.`;
  const summary = `A focused premium guide to ${title.toLowerCase()}.`;
  const oldPreview = foundation ? `${firstName} introduces the purpose of ${oldTitle} and the outcome you will build toward.` : `${firstName} introduces ${oldTitle.toLowerCase()} with one useful idea you can apply today.`;
  const preview = foundation ? `${firstName} introduces the purpose of ${title} and the outcome you will build toward.` : `${firstName} introduces ${title.toLowerCase()} with one useful idea you can apply today.`;
  const fields = { title };
  if (publication.summary === oldSummary) fields.summary = summary;
  for (const key of ["submittedSnapshot", "publishedSnapshot"]) {
    const snapshot = publication[key];
    if (!snapshot?.metadata) continue;
    fields[`${key}.metadata.title`] = title;
    if (snapshot.metadata.summary === oldSummary) fields[`${key}.metadata.summary`] = summary;
    for (const [ci, chapter] of (snapshot.chapters || []).entries()) {
      for (const [bi, block] of (chapter.blocks || []).entries()) {
        if (block.text === oldPreview) fields[`${key}.chapters.${ci}.blocks.${bi}.text`] = preview;
      }
    }
  }
  return { fields, oldPreview, preview };
}
