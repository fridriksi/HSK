// Les upplýsingar um mót eða viðburð úr frjálsum texta (t.d. boðsbréfi eða tölvupósti) með Claude
// og skilar gildum fyrir reitina í forminu. Starfsmaður fer yfir og vistar sjálfur.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { SPORTS, AREAS } from './content-types';

const EventFields = z.object({
  title: z.string().describe('Heiti mótsins eða viðburðarins, stutt og lýsandi'),
  kind: z.enum(['mot', 'vidburdur']).describe('"mot" ef keppt er (mót, keppni, leikar), annars "vidburdur" (námskeið, fundur, þing, hátíð, æfingabúðir)'),
  sport: z.string().describe(`Ein íþróttagrein úr listanum eða tómt: ${SPORTS.join(', ')}`),
  starts_at: z.string().describe('Upphaf á forminu YYYY-MM-DDTHH:MM. Ef klukkan er ekki gefin, notaðu 00:00'),
  ends_at: z.string().describe('Lok á forminu YYYY-MM-DDTHH:MM, eða tómt'),
  location: z.string().describe('Staður, t.d. „Selfossvöllur, Selfossi“, eða tómt'),
  age_groups: z.string().describe('Aldursflokkar, t.d. „11–14 ára, fullorðnir“, eða tómt'),
  organizer: z.string().describe('Mótshaldari eða skipuleggjandi, eða tómt'),
  reg_deadline: z.string().describe('Skráningarfrestur á forminu YYYY-MM-DD, eða tómt'),
  url: z.string().describe('Tengill á skráningu eða nánari upplýsingar (https://...), eða tómt'),
  club: z.string().describe('Nafn aðildarfélags sem heldur mótið, nákvæmlega eins og í listanum yfir félög, eða tómt'),
  description: z.string().describe('Lýsing fyrir vefinn sem einfalt HTML (<p>, <ul>, <li>, <strong>, <a href>). Haltu öllum gagnlegum upplýsingum úr textanum (dagskrá, keppnisgreinar, gjöld, skráning, tengiliðir) en slepptu kveðjum og undirskriftum.'),
});
export type EventFields = z.infer<typeof EventFields>;

export async function readEvent(apiKey: string, text: string, clubs: string[], today: string): Promise<EventFields> {
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: zodOutputFormat(EventFields) },
    system:
      'Þú aðstoðar starfsfólk Héraðssambandsins Skarphéðins (HSK) á Suðurlandi við að skrá mót og viðburði á vefinn. ' +
      'Lestu textann sem límdur er inn og fylltu út reitina. Skrifaðu á íslensku. Notaðu aðeins upplýsingar sem koma fram í textanum; ' +
      'skildu reit eftir tóman ef upplýsingarnar vantar frekar en að giska. ' +
      `Dagurinn í dag er ${today}; ef ár vantar í dagsetningu, notaðu næsta tilvik þeirrar dagsetningar. ` +
      `Sveitarfélög á svæðinu: ${AREAS.join(', ')}.`,
    messages: [{
      role: 'user',
      content: `Aðildarfélög HSK:\n${clubs.join('\n')}\n\n<texti>\n${text}\n</texti>`,
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Ekki tókst að lesa textann.');
  if (!response.parsed_output) throw new Error('Svarið var ekki á réttu formi.');
  return response.parsed_output;
}
