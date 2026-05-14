import { useEffect, useState } from 'react'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import Library from './components/Library'
import Reader from './components/Reader'
import MasterNotes from './components/MasterNotes'
import Flashcards from './components/Flashcards'
import VisualGraph from './components/VisualGraph'
import Settings from './components/Settings'
import ReadingGoals from './components/ReadingGoals'
import Citations from './components/Citations'
import TipsAndTricks from './components/TipsAndTricks'
import LockIn from './components/LockIn'
import Tutorial from './components/Tutorial'

export default function App() {
  const {
    view,
    lockInPhase,
    loadSources,
    loadHighlightTypes,
    loadNotes,
    loadGraphs,
    loadFlashcardStates,
  } = useStore()

  const [showTutorial, setShowTutorial] = useState(
    () => !localStorage.getItem('aris:onboarding-complete')
  )

  const dismissTutorial = () => {
    localStorage.setItem('aris:onboarding-complete', '1')
    setShowTutorial(false)
  }

  useEffect(() => {
    loadSources()
    loadHighlightTypes()
    loadNotes()
    loadGraphs()
    loadFlashcardStates()
  }, [])

  const inSession = lockInPhase !== 'idle'

  return (
    <div className="flex flex-col h-full bg-ink text-blush">
      {!inSession && <TitleBar />}
      <div className="flex flex-1 min-h-0">
        {!inSession && <Sidebar />}
        <main
          className="flex-1 min-w-0 overflow-hidden"
          style={inSession ? { paddingTop: lockInPhase === 'complete' ? 0 : 44 } : undefined}
        >
          {view === 'library' && <Library />}
          {view === 'reader' && <Reader />}
          {view === 'notes' && <MasterNotes />}
          {view === 'flashcards' && <Flashcards />}
          {view === 'graph' && <VisualGraph />}
          {view === 'settings' && <Settings />}
          {view === 'goals' && <ReadingGoals />}
          {view === 'citations' && <Citations />}
          {view === 'tips' && <TipsAndTricks />}
        </main>
      </div>
      <LockIn />
      {showTutorial && <Tutorial onDismiss={dismissTutorial} />}
    </div>
  )
}
