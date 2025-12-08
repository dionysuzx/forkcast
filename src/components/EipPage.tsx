import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { eipsData } from '../data/eips';
import { EIP } from '../types';
import { getLaymanTitle, getProposalPrefix } from '../utils';
import { useMetaTags } from '../hooks/useMetaTags';
import { useAnalytics } from '../hooks/useAnalytics';
import ThemeToggle from './ui/ThemeToggle';
import { EipCard } from './network-upgrade';

const asEips = eipsData as unknown as EIP[];

const EipPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const numericId = Number(id);
  const eip = asEips.find(item => item.id === numericId);
  const { trackLinkClick } = useAnalytics();

  const pageTitle = eip
    ? `${getProposalPrefix(eip)}-${eip.id}: ${getLaymanTitle(eip)} - Forkcast`
    : 'EIP not found - Forkcast';

  const pageDescription = eip
    ? eip.laymanDescription || eip.description
    : 'The requested EIP could not be found on Forkcast.';

  const pageUrl = `https://forkcast.org/eips/${id ?? ''}`;

  useMetaTags({
    title: pageTitle,
    description: pageDescription,
    url: pageUrl,
  });

  const handleExternalLinkClick = (linkType: string, url: string) => {
    trackLinkClick(linkType, url);
  };

  if (!eip) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 flex justify-between items-start">
            <Link to="/" className="text-3xl font-serif bg-gradient-to-r from-purple-600 via-blue-600 to-purple-800 bg-clip-text text-transparent hover:from-purple-700 hover:via-blue-700 hover:to-purple-900 transition-all duration-200 tracking-tight">
              Forkcast
            </Link>
            <ThemeToggle />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            EIP {id} was not found in the Forkcast dataset.
          </p>
          <Link
            to="/"
            className="text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 underline decoration-1 underline-offset-2"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  const primaryForkName = eip.forkRelationships[0]?.forkName;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex justify-between items-start">
          <Link to="/" className="text-3xl font-serif bg-gradient-to-r from-purple-600 via-blue-600 to-purple-800 bg-clip-text text-transparent hover:from-purple-700 hover:via-blue-700 hover:to-purple-900 transition-all duration-200 tracking-tight">
            Forkcast
          </Link>
          <ThemeToggle />
        </div>

        <Link
          to="/"
          className="text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100 mb-4 inline-block text-sm font-medium"
        >
          ← All Network Upgrades
        </Link>

        {primaryForkName && (
          <EipCard
            eip={eip}
            forkName={primaryForkName}
            handleExternalLinkClick={handleExternalLinkClick}
            hideViewFullDetails
            showAllForkRelationships
          />
        )}
      </div>
    </div>
  );
};

export default EipPage;