/**
 * Single source of truth for the controlled vocabularies used by the database,
 * the API filters and the UI. Keeping them here means an admin can never save a
 * category the frontend does not know how to render.
 */

export const CATEGORIES = [
  {
    id: 'ngo',
    label: 'NGO / Rescue group',
    shortLabel: 'NGO',
    blurb: 'Volunteer or charitable rescue organisation',
  },
  {
    id: 'veterinary',
    label: 'Veterinary',
    shortLabel: 'Vet',
    blurb: 'Clinic or hospital that treats injured animals',
  },
  {
    id: 'municipal',
    label: 'Municipal / Animal control',
    shortLabel: 'Municipal',
    blurb: 'Corporation or government animal control unit',
  },
];

export const SERVICES = [
  { id: 'rescue', label: 'Rescue & recovery' },
  { id: 'first_aid', label: 'First aid / treatment' },
  { id: 'ambulance', label: 'Ambulance pickup' },
  { id: 'sterilization', label: 'Sterilisation' },
  { id: 'adoption', label: 'Adoption' },
  { id: 'capture_only', label: 'Stray capture only' },
  { id: 'rehab', label: 'Rehabilitation' },
  { id: 'cremation', label: 'Cremation / disposal' },
  { id: 'shelter', label: 'Shelter' },
];

export const ANIMAL_TYPES = [
  { id: 'dog', label: 'Dog' },
  { id: 'cat', label: 'Cat' },
  { id: 'cattle', label: 'Cattle / cow' },
  { id: 'bird', label: 'Bird' },
  { id: 'goat', label: 'Goat / sheep' },
  { id: 'monkey', label: 'Monkey' },
  { id: 'wildlife', label: 'Wildlife' },
  { id: 'reptile', label: 'Reptile' },
  { id: 'other', label: 'Other' },
];

/**
 * situation_type is an enum in the schema, so a bad value must never reach SQL.
 */
export const SITUATION_TYPES = [
  {
    id: 'injured',
    label: 'Injured',
    hint: 'Bleeding, hit by a vehicle, broken limb, unable to walk',
    needsMedical: true,
  },
  {
    id: 'sick',
    label: 'Sick / weak',
    hint: 'Cannot eat, vomiting, very weak, suspected infection',
    needsMedical: true,
  },
  {
    id: 'trapped',
    label: 'Trapped',
    hint: 'Stuck in a drain, well, pit, wall or net',
    needsCapture: true,
  },
  {
    id: 'aggressive',
    label: 'Aggressive / needs capture',
    hint: 'Feral, panicked or biting risk — needs a trained team',
    needsCapture: true,
  },
  {
    id: 'deceased',
    label: 'Roadkill / deceased',
    hint: 'Needs removal and disposal',
    needsDisposal: true,
  },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const SERVICE_IDS = SERVICES.map((s) => s.id);
export const ANIMAL_TYPE_IDS = ANIMAL_TYPES.map((a) => a.id);
export const SITUATION_IDS = SITUATION_TYPES.map((s) => s.id);

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) || null;
export const serviceLabel = (id) => SERVICES.find((s) => s.id === id)?.label || id;
export const animalLabel = (id) => ANIMAL_TYPES.find((a) => a.id === id)?.label || id;
export const situationLabel = (id) => SITUATION_TYPES.find((s) => s.id === id)?.label || id;
