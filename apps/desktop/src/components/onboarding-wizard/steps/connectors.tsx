import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { ConnectorLogo } from '@/components/ui/connector-logo'
import { SearchField } from '@/components/ui/search-field'
import { Blurb, Chip, StepControls } from '@/components/wizard-shell'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'

// Fake for now — stored, surfaced later when connectors ship for real. Marks
// resolve through the shared ConnectorLogo ladder: curated brand glyph first,
// the product's own favicon where simple-icons has no mark (Slack's left over
// trademark), monogram last.
const CONNECTORS: Array<{ homepage?: string; id: string; name: string }> = [
  { id: 'gmail', name: 'Gmail' },
  { id: 'google-calendar', name: 'Calendar' },
  { id: 'google-drive', name: 'Drive' },
  { homepage: 'https://slack.com', id: 'slack', name: 'Slack' },
  { id: 'github', name: 'GitHub' },
  { id: 'notion', name: 'Notion' },
  { id: 'linear', name: 'Linear' },
  { id: 'figma', name: 'Figma' },
  { id: 'discord', name: 'Discord' },
  { id: 'telegram', name: 'Telegram' },
  { id: 'spotify', name: 'Spotify' },
  { id: 'stripe', name: 'Stripe' }
]

export function ConnectorsStep() {
  const answers = useStore($wizardAnswers)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visible = needle ? CONNECTORS.filter(connector => connector.name.toLowerCase().includes(needle)) : CONNECTORS

  const toggle = (id: string) =>
    setWizardAnswers({
      connectors: answers.connectors.includes(id)
        ? answers.connectors.filter(item => item !== id)
        : [...answers.connectors, id]
    })

  return (
    <div>
      <Blurb>
        Hermes can reach the tools you already use. Pick what you&apos;d like connected — setup happens later, in
        Settings, when you&apos;re ready.
      </Blurb>
      <StepControls>
        <SearchField containerClassName="mb-3 w-full" onChange={setQuery} placeholder="Search" value={query} />
        <div className="grid grid-cols-3 gap-2">
          {visible.map(connector => (
            <Chip
              icon={
                <ConnectorLogo
                  className="size-7 rounded-full text-sm"
                  connector={{ homepage: connector.homepage, name: connector.id, title: connector.name }}
                />
              }
              key={connector.id}
              label={connector.name}
              on={answers.connectors.includes(connector.id)}
              onToggle={() => toggle(connector.id)}
            />
          ))}
        </div>
      </StepControls>
    </div>
  )
}
