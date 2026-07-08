export type VenueType = 'conference' | 'journal'

export interface VenueInfo {
  canonical: string
  type: VenueType
}

interface VenueEntry {
  canonical: string
  type: VenueType
  patterns: RegExp[]
}

const VENUES: VenueEntry[] = [
  {
    canonical: 'CVPR', type: 'conference',
    patterns: [/\bCVPR\b/, /Computer Vision and Pattern Recognition/i]
  },
  {
    canonical: 'ICCV', type: 'conference',
    patterns: [/\bICCV\b/, /International Conference on Computer Vision\b/i]
  },
  {
    canonical: 'ECCV', type: 'conference',
    patterns: [/\bECCV\b/, /European Conference on Computer Vision\b/i]
  },
  {
    canonical: 'WACV', type: 'conference',
    patterns: [/\bWACV\b/, /Winter Conference on Applications of Computer Vision\b/i]
  },
  {
    canonical: 'BMVC', type: 'conference',
    patterns: [/\bBMVC\b/, /British Machine Vision Conference\b/i]
  },
  {
    canonical: 'NeurIPS', type: 'conference',
    patterns: [/\bNeurIPS\b/, /\bNIPS\b/, /Neural Information Processing Systems\b/i, /Advances in Neural Information Processing Systems\b/i]
  },
  {
    canonical: 'ICML', type: 'conference',
    patterns: [/\bICML\b/, /International Conference on Machine Learning\b/i]
  },
  {
    canonical: 'ICLR', type: 'conference',
    patterns: [/\bICLR\b/, /International Conference on Learning Representations\b/i]
  },
  {
    canonical: 'AAAI', type: 'conference',
    patterns: [/\bAAAI\b/, /AAAI Conference on Artificial Intelligence\b/i, /Association for the Advancement of Artificial Intelligence\b/i]
  },
  {
    canonical: 'IJCAI', type: 'conference',
    patterns: [/\bIJCAI\b/, /International Joint Conference on Artificial Intelligence\b/i]
  },
  {
    canonical: 'ACL', type: 'conference',
    patterns: [/\bACL\b/, /Annual Meeting of the Association for Computational Linguistics\b/i]
  },
  {
    canonical: 'EMNLP', type: 'conference',
    patterns: [/\bEMNLP\b/, /Empirical Methods in Natural Language Processing\b/i]
  },
  {
    canonical: 'NAACL', type: 'conference',
    patterns: [/\bNAACL\b/, /North American Chapter of the Association for Computational Linguistics\b/i]
  },
  {
    canonical: 'COLING', type: 'conference',
    patterns: [/\bCOLING\b/, /International Conference on Computational Linguistics\b/i]
  },
  {
    canonical: 'KDD', type: 'conference',
    patterns: [/\bKDD\b/, /Knowledge Discovery and Data Mining\b/i]
  },
  {
    canonical: 'SIGMOD', type: 'conference',
    patterns: [/\bSIGMOD\b/, /International Conference on Management of Data\b/i]
  },
  {
    canonical: 'VLDB', type: 'conference',
    patterns: [/\bVLDB\b/, /Very Large Data Bases\b/i]
  },
  {
    canonical: 'ICDE', type: 'conference',
    patterns: [/\bICDE\b/, /International Conference on Data Engineering\b/i]
  },
  {
    canonical: 'WWW', type: 'conference',
    patterns: [/\bWWW\b/, /The Web Conference\b/i, /International World Wide Web Conferences?\b/i]
  },
  {
    canonical: 'SIGGRAPH', type: 'conference',
    patterns: [/\bSIGGRAPH\b/, /International Conference on Computer Graphics and Interactive Techniques\b/i]
  },
  {
    canonical: 'ICRA', type: 'conference',
    patterns: [/\bICRA\b/, /International Conference on Robotics and Automation\b/i]
  },
  {
    canonical: 'IROS', type: 'conference',
    patterns: [/\bIROS\b/, /International Conference on Intelligent Robots and Systems\b/i]
  },
  {
    canonical: 'RSS', type: 'conference',
    patterns: [/\bRSS\b.*Robot|Robotics: Science and Systems\b/i]
  },
  {
    canonical: 'SOSP', type: 'conference',
    patterns: [/\bSOSP\b/, /Symposium on Operating Systems Principles\b/i]
  },
  {
    canonical: 'OSDI', type: 'conference',
    patterns: [/\bOSDI\b/, /Operating Systems Design and Implementation\b/i]
  },
  {
    canonical: 'NSDI', type: 'conference',
    patterns: [/\bNSDI\b/, /Symposium on Networked Systems Design and Implementation\b/i]
  },
  {
    canonical: 'EuroSys', type: 'conference',
    patterns: [/\bEuroSys\b/, /European Conference on Computer Systems\b/i]
  },
  {
    canonical: 'USENIX ATC', type: 'conference',
    patterns: [/\bUSENIX\s*ATC\b/, /USENIX Annual Technical Conference\b/i]
  },
  {
    canonical: 'CCS', type: 'conference',
    patterns: [/\bCCS\b.*Security|Computer and Communications Security\b/i]
  },
  {
    canonical: 'S&P', type: 'conference',
    patterns: [/\bS\s*&\s*P\b/, /IEEE Symposium on Security and Privacy\b/i]
  },
  {
    canonical: 'NDSS', type: 'conference',
    patterns: [/\bNDSS\b/, /Network and Distributed System Security Symposium\b/i]
  },
  {
    canonical: 'ICASSP', type: 'conference',
    patterns: [/\bICASSP\b/, /International Conference on Acoustics, Speech and Signal Processing\b/i]
  },
  {
    canonical: 'ACML', type: 'conference',
    patterns: [/\bACML\b/, /Asian Conference on Machine Learning\b/i]
  },
  {
    canonical: 'CoRL', type: 'conference',
    patterns: [/\bCoRL\b/, /Conference on Robot Learning\b/i]
  },
  {
    canonical: '3DV', type: 'conference',
    patterns: [/\b3DV\b/, /International Conference on 3D Vision\b/i]
  },
  {
    canonical: 'WSDM', type: 'conference',
    patterns: [/\bWSDM\b/, /Web Search and Data Mining\b/i]
  },
  {
    canonical: 'RECOMB', type: 'conference',
    patterns: [/\bRECOMB\b/, /Research in Computational Molecular Biology\b/i]
  },
  {
    canonical: 'MICCAI', type: 'conference',
    patterns: [/\bMICCAI\b/, /Medical Image Computing and Computer Assisted Intervention\b/i]
  },
  {
    canonical: 'Lecture Notes in Computer Science', type: 'conference',
    patterns: [/Lecture Notes in Computer Science\b/i, /\bLNCS\b/]
  },
  {
    canonical: 'Communications of the ACM', type: 'journal',
    patterns: [/Communications of the ACM\b/i, /\bCACM\b/]
  },
  {
    canonical: 'IEEE Transactions on Pattern Analysis and Machine Intelligence', type: 'journal',
    patterns: [/Pattern Analysis and Machine Intelligence\b/i, /\bTPAMI\b/, /\bIEEE Trans\.?\s*Pattern Anal/i]
  },
  {
    canonical: 'IEEE Transactions on Image Processing', type: 'journal',
    patterns: [/\bIEEE Transactions on Image Processing\b/i, /\bTIP\b.*Image|Image Processing\b.*IEEE Trans/i, /\bIEEE Trans\.?\s*Image Process/i]
  },
  {
    canonical: 'IEEE Transactions on Neural Networks and Learning Systems', type: 'journal',
    patterns: [/\bIEEE Transactions on Neural Networks\b/i, /Neural Networks and Learning Systems\b/i]
  },
  {
    canonical: 'IEEE Transactions on Knowledge and Data Engineering', type: 'journal',
    patterns: [/Knowledge and Data Engineering\b/i, /\bTKDE\b/]
  },
  {
    canonical: 'IEEE Transactions on Multimedia', type: 'journal',
    patterns: [/\bIEEE Transactions on Multimedia\b/i]
  },
  {
    canonical: 'IEEE Transactions on Visualization and Computer Graphics', type: 'journal',
    patterns: [/Visualization and Computer Graphics\b/i, /\bTVCG\b/]
  },
  {
    canonical: 'IEEE Transactions on Information Forensics and Security', type: 'journal',
    patterns: [/Information Forensics and Security\b/i, /\bTIFS\b/]
  },
  {
    canonical: 'IEEE Transactions on Circuits and Systems for Video Technology', type: 'journal',
    patterns: [/Circuits and Systems for Video Technology\b/i, /\bTCSVT\b/]
  },
  {
    canonical: 'IEEE Transactions on Signal Processing', type: 'journal',
    patterns: [/\bIEEE Transactions on Signal Processing\b/i]
  },
  {
    canonical: 'ACM Computing Surveys', type: 'journal',
    patterns: [/ACM Computing Surveys\b/i, /\bCSUR\b/]
  },
  {
    canonical: 'ACM Transactions on Graphics', type: 'journal',
    patterns: [/ACM Transactions on Graphics\b/i, /\bTOG\b/]
  },
  {
    canonical: 'Journal of Machine Learning Research', type: 'journal',
    patterns: [/\bJMLR\b/, /Journal of Machine Learning Research\b/i]
  },
  {
    canonical: 'Pattern Recognition', type: 'journal',
    patterns: [/^Pattern Recognition$/i, /^Pattern Recognition\s*$/]
  },
  {
    canonical: 'Neurocomputing', type: 'journal',
    patterns: [/^Neurocomputing$/i]
  },
  {
    canonical: 'Knowledge-Based Systems', type: 'journal',
    patterns: [/Knowledge-Based Systems\b/i]
  },
  {
    canonical: 'Information Fusion', type: 'journal',
    patterns: [/^Information Fusion$/i]
  },
  {
    canonical: 'Expert Systems with Applications', type: 'journal',
    patterns: [/Expert Systems with Applications\b/i]
  },
  {
    canonical: 'Neural Networks', type: 'journal',
    patterns: [/^Neural Networks$/i]
  },
  {
    canonical: 'Neural Computing and Applications', type: 'journal',
    patterns: [/Neural Computing and Applications\b/i]
  },
  {
    canonical: 'Artificial Intelligence', type: 'journal',
    patterns: [/^Artificial Intelligence$/i]
  },
  {
    canonical: 'Machine Learning', type: 'journal',
    patterns: [/^Machine Learning$/i]
  },
  {
    canonical: 'Computer Vision and Image Understanding', type: 'journal',
    patterns: [/Computer Vision and Image Understanding\b/i, /\bCVIU\b/]
  },
  {
    canonical: 'Image and Vision Computing', type: 'journal',
    patterns: [/Image and Vision Computing\b/i]
  },
  {
    canonical: 'International Journal of Computer Vision', type: 'journal',
    patterns: [/\bIJCV\b/, /International Journal of Computer Vision\b/i]
  },
  {
    canonical: 'Journal of Neuroscience Methods', type: 'journal',
    patterns: [/Journal of Neuroscience Methods\b/i]
  },
  {
    canonical: 'Vehicular Communications', type: 'journal',
    patterns: [/^Vehicular Communications$/i]
  },
  {
    canonical: 'Information Sciences', type: 'journal',
    patterns: [/^Information Sciences$/i]
  },
  {
    canonical: 'Science of Computer Programming', type: 'journal',
    patterns: [/Science of Computer Programming\b/i]
  },
  {
    canonical: 'Journal of Visual Communication and Image Representation', type: 'journal',
    patterns: [/Visual Communication and Image Representation\b/i, /\bJ\.?\s*Vis\.?\s*Commun\.?\s*Image/i]
  },
  {
    canonical: 'IEEE Access', type: 'journal',
    patterns: [/^IEEE Access$/i]
  },
  {
    canonical: 'IEEE Signal Processing Letters', type: 'journal',
    patterns: [/IEEE Signal Processing Letters\b/i]
  },
  {
    canonical: 'IEEE Internet of Things Journal', type: 'journal',
    patterns: [/Internet of Things Journal\b/i]
  },
  {
    canonical: 'IEEE Journal of Selected Topics in Signal Processing', type: 'journal',
    patterns: [/Selected Topics in Signal Processing\b/i]
  }
]

const JOURNAL_HINTS = /(\btransactions\b|\bjournal\b|\breview\b|\bannals\b|\bmagazine\b|\bletters?\b)/i

export function lookupVenue(venue: string): VenueInfo | null {
  if (!venue || venue.trim().length === 0) return null
  const v = venue.trim()
  for (const entry of VENUES) {
    for (const p of entry.patterns) {
      if (p.test(v)) return { canonical: entry.canonical, type: entry.type }
    }
  }
  return null
}

export function normalizeVenue(venue: string): string {
  const info = lookupVenue(venue)
  return info ? info.canonical : venue
}

export function venueType(venue: string): VenueType | null {
  const info = lookupVenue(venue)
  if (info) return info.type
  if (JOURNAL_HINTS.test(venue)) return 'journal'
  return null
}