// Responsibility: seal fixed identities, evidence, plans, and message classification.
import {
  canonicalJson,
  digestValue,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeV2EvidenceItem }
  from "./canonical-squash-batch-terminalizer-v2.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";

export const OPERATION = "canonical-squash-batch-terminalizer-v2";
export const EVIDENCE_SCHEMA = `agentic-${OPERATION}-evidence/v1`;
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const JOURNAL_SCHEMA = `agentic-${OPERATION}-journal/v1`;
export const RECEIPT_SCHEMA = `agentic-${OPERATION}-receipt/v1`;
export const CAPABILITY_REPORT_SCHEMA = `agentic-${OPERATION}-capability-report/v1`;
const SHA = /^(?!0{40}$)[0-9a-f]{40}$/u;
const DIGEST = /^(?!0{64}$)[0-9a-f]{64}$/u;
const LEASE_PROJECTION_FIELDS = Object.freeze([
  "schema", "epoch", "sessionId", "device", "scope", "branch", "worktreePath", "baseSha",
  "fenceSha", "pullRequestUrl", "autoDelivery", "runtimeRequired", "ownedDirtRecovery",
  "pullRequestProjectionRepair", "reviewHeadSha", "deliveryHeadSha", "parkHeadSha",
  "parkBranchHeadSha", "parkSourceEpoch", "parkSourceFenceSha", "parkStashRef", "parkStashSha",
  "parkStashMessage", "parkStashStatus", "acquiredAt", "admission", "cloudAuthority", "integration",
]);
const NULL_LEASE_FIELDS = new Set(["ownedDirtRecovery", "pullRequestProjectionRepair",
  "reviewHeadSha", "parkHeadSha", "parkBranchHeadSha", "parkSourceEpoch",
  "parkSourceFenceSha", "parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus"]);
const SUCCESSOR_FIELDS = Object.freeze(["activeOwnedDirtRecovery",
  "activeOwnedDirtCurrentBaseReanchor", "activePublishTaskAuthoritySuccessor",
  "activePublishSuccessorIntent"]);
const SOURCE_VERIFICATION_DIGEST = "65823b0d024d9ade98ebc4eb755c089ec7ed19b1844a802e6e4f12b31a2b34d2";
const COMMON_ATTRIBUTION_DIGEST = "c8036dfdc0a15da4ce7d71d7ed9c71543281823edb5262ae35e67cc25dd64022";
const HEADLINES = Object.freeze({
  818:"feat(canonical-squash-recovery-terminalizer): terminalize recovery",
  820:"test(expired-heartbeat-fixture-clock): freeze live clock",
  822:"fix(active-owned-dirt-reanchor-legacy-work-item): keep identity",
  823:"fix(github-strong-conditional-pull-body): bind strong tag",
  824:"fix(github-cooperative-pull-body-projection): project body safely",
  825:"fix(active-dirt-marker-replay-order): restore marker replay",
  826:"docs(canonical-squash-pr818-attribution-recovery): record evidence",
  828:"fix(claim-only-waiting-bridge-live-topology): reconcile peers",
});
const MESSAGE_IDENTITIES = Object.freeze({
  818: ["bfafe54b3ea7a9c2e9ffcb6194c66f2f62bf6c8b611a24be0bbad0d940c6b899", "716518b027cf3e6eba5e685cc3c69b316637f2244dc46d7275944a4eee0fb119", "6fbe1d3a71f87dcd278857f351bfec4fdb1d992dcd41178c1cfe569ccd8469f6", "68a7a8c51de80bb6a26433031d421f3752fd8c0c997334da7b825b61fdab5650", "b6fc8e153379331db62165f592e33a91c231ea139fc9834cd2ed15557bf91e0c", "c5db2809d90dd8b0be1595efae2da19248c01ade44891604b2b88ac8de8a3c86"],
  820: ["662a48e5f451a38a320a693bb30e4b950a4cf1308bb02892c515acdca7699f19", "7379a7b404c60fb051c7c7637ef7cd08c2fa5e2d8fb970e7ea1d6d61d77b3332", "9c13dc2b095c05ebf14edc6dc4b6f5a209f421cf4f0b6c5c08f5898491d15520", "0841f0b2d42ed8ab7ba66cb799b632f0f2e2385fd1b9e97168f582b4c71511a2", COMMON_ATTRIBUTION_DIGEST, "a73349067ab8038ef9a11dea819ce5889c773192b9bb878ff9acf509db833724"],
  822: ["e732ae00c20d441cc4b94f5683ce77145c494a5eacc441bbb81b830f3ecb6a68", "baf62784c2c22735f9fae7ffeef07ebf5e507ead405216af88bae8de39f9ac8e", "6084d4e0d7adffba193b9f5d2d8ac9f9a8d88cfb34f59ed6378078f09fb01956", "413479a44c3238d0a342387c2f43e048fe519285833088deb3c2c63f7893c4c0", COMMON_ATTRIBUTION_DIGEST, "5453fb56ca1ee69a87d28b92b6b107e6464c32d092452c625708b5d722045e2f"],
  823: ["f17c9606c811fca62ea1f8dacb2bac777dcb43c33a745c48c561c1d9da33d57c", "63dc7c1949c523f50ea6ee4fd18493fcd9e9b0f37acb5098479b04f4071b0adb", "0f678eb0f6e650f5200cff9bbbe5e2deff433af89c9e4f122a999eeafc99a6e2", "27e5b1753dc65a0fc49f71bfc86329a42aded7b07a8c007031a6e2d3200c4878", COMMON_ATTRIBUTION_DIGEST, "830c97b93f4c2d044acc02663e9323d8d4f1d28dda2fec800917df0e54ee70e7"],
  824: ["536a05acd2710ab2744e47aac56882e58aec7950f461bde752fbc210a21bc80e", "44e85ae983d134def2a9d62e7b9de2b92a378bfaf6460f6d67677186fb7236ea", "8dffc134f9e9cbfd557abfcffa032c9fb11b68b3fa257927f941ad5aa96618ae", "9657ad510e9e45204c3bcc465cec06103bb566678349d6d16ffb0bc37c929523", COMMON_ATTRIBUTION_DIGEST, "6945e73e8776398d51bfdb706192820fc4642b20056156a3a6e29da6787eb3ac"],
  825: ["ac929658ad94a85be4e0e01390543aa4ce6f66d283703e5943cec198cfde480e", "d1213279ee6650fe9e24113e95c39bee468e26c8d6d1bff98874881042382171", "d62ab1308349eb0a04b76c51294574305afa866c3023f2a6b93caa91a93838c8", "e0dc9574201d3c9cc73ccd3002461e8ab1cddaa3526d0c34cc4694ada71a294a", COMMON_ATTRIBUTION_DIGEST, "2347719536ac3efc5fdee8cb4d880a7c25c1b6132953828a81f9b14fbe0588af"],
  826: ["5991e75d0ff8ca36c91846b5944a1776a0f243088e87bcc673c1940ebb4ae40f", "85ba20f8213f277884d35045ea74ecd10e6a1697a8b00495091b2e4bbbea6be9", "c51f37396f30a86bc7ed93e9d4a7a30fa5cc63530336e34a9dd5972d393189cc", "ceb40b8394e51b134a26cbe4807d7849797dcf22d1eeccd1a4d2b4322c78eada", COMMON_ATTRIBUTION_DIGEST, "8d032e1f2e21f150b2ad0e51b78567448dc02694aea2ead860ea164184e496e7"],
  828: ["1e047f403e2233215ee8cf5c8097e0a013ba2897b76d98a71d45914d928bf977", "8917493779827ea5bb38cdfd333ccb0ee6c39a39095e774a8158e30aa468607e", "5609cfce46b629cc4af067a9ec64a6eb152de0e98fe6a7986d9a85f2b417b27c", "d1609856cc407d33e2f805fe832455ab09980f23845a4e071c721bab38790eb5", COMMON_ATTRIBUTION_DIGEST, "1c2d52c7d0745785b307f43ae1b021bbce6c036279628dd0b3eb4fc3dce019c0"],
});
const RUN_IDENTITIES = Object.freeze({
  818: ["91b2ce5b959bb5368db169af03decd7fa9e513d4f950beeb6c3f2af46780d177", "26530a52fab0556115f9ebf490e740d23f30bc1d48a444ff7ea567808d3be3aa", [99318738337,99318754136,99318754149,99318754154,99318754156,99318754170,99318754171,99318754175,99318754182,99318817727,99319098192], "2c1327c0907e47f3fe95661b80579a5244f26d1f8b3e7133ab4692e37fe730eb", "d2a2cc664998fed56044d540936bfa1bcc044bd8772aeed8c96da0b024d11123", [99319191912,99319203049,99319203067,99319203112,99319203123,99319203144,99319203153,99319203194,99319203203,99319406183,99319433525]],
  820: ["89e2ea7f00746545f60be61927dfdde394372bb8a289efec4dead985038ea7f0", "ca7e36715c8027f5668fbf672530a3d96bdc9eb4265d5aaf0b8585943fce8b20", [99274421247,99274435232,99274435235,99274435243,99274435256,99274435273,99274435275,99274435278,99274435305,99274497989,99274665816], "09b692cec5de30c46162cd48a51be4d4f3d85a6540c990c0c4e98f45ded0a6bc", "04edd54b3a53d6ad9b037dda5db1aa3b60930b2774af297710f4e950c4095caa", [99274718861,99274728414,99274728420,99274728459,99274728500,99274728514,99274728517,99274728585,99274728591,99274823903,99274979603]],
  822: ["731d44b4153a8b5560dd891b70e3fc5ca32e29f83dacbf3888c37275450da3cb", "b53c102298c36a2bc0ec8fb9fe5dc1a9c1d5983436a33d2693c3584192b37bac", [99294065510,99294084804,99294084824,99294084831,99294084848,99294084850,99294084857,99294084864,99294084877,99294145726,99294417766], "4253d1e1c443981f19f0d5d5898d2501b21a13788760fc9477b95a09f000e2e2", "9680adb2e7f45836b9b9b96c1fd1a89506733163194d4bd47c64e7eb3a8d677c", [99294442616,99294452540,99294452546,99294452548,99294452563,99294452584,99294452592,99294452595,99294452639,99294511094,99294815716]],
  823: ["805dbce681267cf67f6761a63734a622c43a6a026283d5be4265bf8d7bbd1de5", "6211022c1f62c0016bf7ed5f0ff5fb88b7d1547244426cdbaebeab523d280630", [99301664523,99301679928,99301679931,99301679949,99301679953,99301679971,99301679981,99301679987,99301680006,99301829988,99301961788], "650ed10bea96de8a6332faf4e8424850acacee58a44220e53ae719e46531b122", "6c1212d80ef624b738704da55599e89943756bc1c7ac70bb4d1b7fc55728cf08", [99302023050,99302041826,99302041848,99302041856,99302041861,99302041870,99302041874,99302041878,99302041902,99302106964,99302806858]],
  824: ["8ed5aa326ad29c652a6d6af0d0fe205ff110e134b9874b44c6f4e8c0b2fc30e4", "5e0cc56f305efd60ce5fa106b6c30366ce15c9336787cbfada9db087e7218273", [99307965751,99307977670,99307977680,99307977709,99307977725,99307977745,99307977753,99307977764,99307977772,99308041447,99308250877], "763cfced9ee2fc98ace9f2a47511721e843149254baf752dbfa446fc953c6473", "10f762fcc852485503ebd691dcdf416201579be82268e51bd4684d651b029fa2", [99308280179,99308294868,99308294912,99308294915,99308294918,99308294928,99308294968,99308295001,99308295043,99308413356,99308525782]],
  825: ["6231b09d779ff75827a3b1e73e052abf31998d481fb5b46d9920ae74c76d8ae6", "cceccae53688de3cb4473a63e1ca10176b641f38f863b3e20c082b8dfd8c9d2a", [99315414430,99315429084,99315429097,99315429099,99315429103,99315429105,99315429116,99315429141,99315429199,99315517652,99315677415], "3834fcee9bc6dac0ab1dd2dea6b0c093c37dd716cb8687ed5f9f3b223dc3f61a", "07d9159c92f40544a5309966d7ba3f3d25320ae8e4cc4cc1f34634f9ba183064", [99315834720,99315859753,99315859767,99315859774,99315859792,99315859825,99315859839,99315859851,99315859863,99315933915,99316134999]],
  826: ["fb80ecc8ad6c82180d3bf63df750a0c144837549437ba51a7f8ce3ff74025f81", "9ec635b6d38804765a0086672032d56a8705d33a648d9434a1a918c91e5d4d88", [99322695610,99322708070,99322708087,99322708106,99322708130,99322708191,99322708203,99322708223,99322708241,99322817336,99323019605], "f3c6240a58eea15f16b351856cfdaecd09e00e056ee67ed46ee26a4d7db2d3cc", "649ff8cb4ae432aee578f0b82302193d95ae22b5c956389c65b5aa10ee43c3ff", [99323050790,99323065822,99323065832,99323065848,99323065854,99323065855,99323065868,99323065884,99323065891,99323242240,99323301932]],
  828: ["2404ffbca51a6f06d072f10f05c832b953f4562a4c1b8c97498540802dd3031e", "c86c06ea0fd4e87c8a754918fc1ea19f13468a6aa4337824712d7700a4e48f07", [99335762889,99335777802,99335777806,99335777812,99335777815,99335777827,99335777833,99335777840,99335777880,99335849706,99336142017], "94a8a6a91bc5e1c52d15076840b2747a057df068c8ddcf4cfa4f67b745369f37", "03942a9d28472aa864685c8180b99e5925dd2bc78f928f56fc4307d03c8d6ef1", [99336212981,99336222654,99336222659,99336222682,99336222689,99336222695,99336222696,99336222704,99336222750,99336303220,99336547918]],
});
const RUN_METADATA = Object.freeze({
  818:["WFR_kwLOSr5-fM8AAAAHwuNtMA",90327354495,3139,"WFR_kwLOSr5-fM8AAAAHwuYAVw",90327778370,3140],
  820:["WFR_kwLOSr5-fM8AAAAHweXSCg",90284940716,3113,"WFR_kwLOSr5-fM8AAAAHweeJIA",90285225248,3114],
  822:["WFR_kwLOSr5-fM8AAAAHwlaqWQ",90303819854,3123,"WFR_kwLOSr5-fM8AAAAHwljL7A",90304187320,3124],
  823:["WFR_kwLOSr5-fM8AAAAHwoIfWg",90311153168,3128,"WFR_kwLOSr5-fM8AAAAHwoQtQw",90311496355,3129],
  824:["WFR_kwLOSr5-fM8AAAAHwqW6JQ",90317168684,3132,"WFR_kwLOSr5-fM8AAAAHwqgpfg",90317571380,3133],
  825:["WFR_kwLOSr5-fM8AAAAHwtBz9Q",90324216196,3136,"WFR_kwLOSr5-fM8AAAAHwtLVsg",90324624997,3137],
  826:["WFR_kwLOSr5-fM8AAAAHwvnn2g",90331026281,3143,"WFR_kwLOSr5-fM8AAAAHwvvw6g",90331356545,3144],
  828:["WFR_kwLOSr5-fM8AAAAHw0MGMA",90342977909,3151,"WFR_kwLOSr5-fM8AAAAHw0WuQg",90343386994,3152],
});
export const FIXED_PULL_REQUESTS = Object.freeze([
  818, 820, 822, 823, 824, 825, 826, 828,
]);
export const FIXED_SUBJECTS = freeze([
  fixedSubject({ pullRequest: 818, nodeId: "PR_kwDOSr5-fM8AAAABBf-hDQ",
    branch: "agent/katrinas-macbook-pro.local/canonical-squash-recovery-terminalizer",
    scope: "canonical-squash-recovery-terminalizer", sessionId: "canonical-squash-recovery-terminalizer-20260830",
    worktreeBasename: "canonical-squash-recovery-terminalizer", localEpoch: 321,
    baseSha: "ed7461e5b272da1cba4cd31c079e12259965eaf1", headSha: "d29a375715b0a363c475dac0bc33969fad4aa82e",
    treeSha: "196fc18e560474b04055184a0f6e4f67e66c8e81", mergeSha: "ef37a86ac7064c674a972d2afdd8e822ead7de69",
    sourceRawSha256: "24be1341de56d2cb5514f8e20a6b1fa35a19421d608769f612d1df5c5d43e2a0", sourceRawBytes: 434,
    protectedRawSha256: "10659bb72fe98ec56418d7f8170b9ec692243a21764ddc491b1a7b44d58c54e9", protectedRawBytes: 714,
    reviewedRunId: 33334455600, postMainRunId: 33334624343,
    fenceSha: "d29a375715b0a363c475dac0bc33969fad4aa82e", leaseIdentityDigest: "821a25207549f1b4ef91d3d944f92df52615d0613c6c998392cce4b2d350ee10",
    claimId: "d191efeece375429d73bd7da15d78e80f46ceadaf37f3499f4a91687713bdcab", claimDigest: "23ebcbfb93f48ac0b190e7f97563db7aefa938004b946edd1861667e769efa68",
    cloudEpoch: 3, cloudTransition: 5, integrationReceiptDigest: "50bf7816901a9fa563f76bee7a668d6422872711fa30a2a5c3085423d1a5c7bd",
    taskSubject: "urn:agentic-task:1a6afd5c2f6b4071ee6a4d5965ff76a76b7a428c6ab1056a21ac577b3c810f72", publicKeyDigest: "a83d959e5cc592ec67ac63616e2e5a15b3aba123315a7dd608350acea15714dc",
    laneBindingDigest: "45c15799aa0d7d687b2aeb921b7ceb52b5b7b4116e39641370dc73df022c0399", bindingDigest: "957014bbe4a027b96a048b1c60f9139b2e608ac48ab69bd8581c50fa6c3ed091",
    bindingMode: "continuation", priorBindingDigest: "183e3466a7234599cc5269032ad1b9297a5c2f53bad461ac70cb3bda3549c58a",
    integrationCommit: "feddc30a5e24f7bd602bb8d7bf8720c0f544a9be", integrationTree: "c68b1dd8726093ea89509703e7cf9fa47c6ad9ce",
    manifestDigest: "21b3c78b0f8add3a5141c275f34a236b3784f7667162155e3d8e88299869ec3e", stagedDiffDigest: "69dba572db42ab221560c91e0bdd93b0750ad2f0c5873597e0dc90a5b19e8fee",
    pathsDigest: "310d5823874f5dcd254d9f7e1c697a579a3c328aa9ed87abac78523858fbf68e", protectedRefresh: true }),
  fixedSubject({ pullRequest: 820, nodeId: "PR_kwDOSr5-fM8AAAABBgiaWQ", branch: "agent/katrinas-macbook-pro.local/expired-heartbeat-fixture-clock",
    scope: "expired-heartbeat-fixture-clock", sessionId: "expired-heartbeat-fixture-clock-20260830", worktreeBasename: "expired-heartbeat-fixture-clock", localEpoch: 319,
    baseSha: "a2fd604b8471659ccbbf1bdc5a7ac0757872141c", headSha: "09f55072de60dea9bc65d153366b768f19c428a1", treeSha: "ff47748cf77bb3b94c173934a95265c3313061bf", mergeSha: "00c0e0ac295fd7d0f81b2fadf014b81e474fab0e",
    sourceRawSha256: "a92c6134b5270b210de95a14e0fd88f9eb12c88bda4c9d9aef1203ff1175aec3", sourceRawBytes: 403, protectedRawSha256: "5ad73f156acdb12f0c426597ddb15e71c89f3a59cb0c8578568fbfd944bfd360", protectedRawBytes: 602,
    reviewedRunId: 33317835274, postMainRunId: 33317947680, fenceSha: "e9a35859b82d394bbeacad10f6d124ef959905c6", leaseIdentityDigest: "e58fb13a87f0d5ab9d950937a104d3a09d97d81e957c5b1fb0e2a340f4bb4b2c",
    claimId: "7550e86e238af66e5e1786daae94f5e5cbb692ed5222ee6579188ac3ebd9cb27", claimDigest: "528f253981d8c8d8a1f67b34deb388f91f11d0a19f9c26f683a510641662a444", cloudEpoch: 1, cloudTransition: 5, integrationReceiptDigest: "022f91eff0aa7e9412c8b0c262de32d3bdf0d0c0716415d829c38e2bce59e0f3",
    taskSubject: "urn:agentic-task:38e8b07801a87f15aa3516077e215cecc2881f1fd4401a924f41c21125568ba1", publicKeyDigest: "c9a415965bbcac45d6767e34620cece5b1ff3653abaf1c032f24a144cddab549", laneBindingDigest: "d69628a9cea1069327cb9094e3cfd86fcf7c04c7ab8c18c11177f2234f86ead2", bindingMode: "claim", priorBindingDigest: null, bindingDigest: "b5258c5fa7669c1972f5a3c4baf42bc95fc8a59df65f2dd5081006d1606929a2",
    integrationCommit: "09f55072de60dea9bc65d153366b768f19c428a1", integrationTree: "ff47748cf77bb3b94c173934a95265c3313061bf", manifestDigest: "9f3b134e6b82129855ba7431cc230f704f95b391956a9e2923b1936f766bbd21", stagedDiffDigest: "d8a5b53929c584e549741704408210c5b16db7fa247eb7be15caff2c3b64505a", pathsDigest: "4fb0d4f68a9785228d9ddcf584fbfb2e7f2dd70316675fa63cc49d10d86ff518", protectedRefresh: false }),
  fixedSubject({ pullRequest: 822, nodeId: "PR_kwDOSr5-fM8AAAABBhFF0Q", branch: "agent/katrinas-macbook-pro.local/active-owned-dirt-reanchor-legacy-work-item",
    scope: "active-owned-dirt-reanchor-legacy-work-item", sessionId: "active-owned-dirt-reanchor-legacy-work-item-20260830", worktreeBasename: "active-owned-dirt-reanchor-legacy-work-item", localEpoch: 322,
    baseSha: "fc2a04e8a3f2adfcdd2972446e3ee7aa5f3003ac", headSha: "a5cceab16c733b3ca412f06cbf43f536f3d66569", treeSha: "df405c740512af47a1d92ff1a01d8f92b5795624", mergeSha: "82bbe12e4eefca86752138647ea5f3ee4989cbd8",
    sourceRawSha256: "67399f18e8e9c62dab6d96d2caa5074aad14c1a4d16f5511f0a1d2765549b214", sourceRawBytes: 446, protectedRawSha256: "3e48edd83a27322895669a4a9a74d13378da0dc4da302109ae8929913cc75f5a", protectedRawBytes: 664,
    reviewedRunId: 33325230681, postMainRunId: 33325370348, fenceSha: "4ed720f42af2662e0fd380289c0a14d9f21a4311", leaseIdentityDigest: "4a8700026f842dc962b468570beb7435d534b0ebf283b1567848da1074ceb4c1",
    claimId: "1ecfa6e84c67b91a32ee448e2066495fa7a0d4ca01c1de2e2dbd8a4d6f892936", claimDigest: "cf24c2f4cbcb0632c46bdabb2b5bc070c195613baa726568fd1f3d49dd7653ea", cloudEpoch: 1, cloudTransition: 5, integrationReceiptDigest: "90b8819cdfd0d56fc867b1b7b788d6fbce75cfd75f90f1ea6a78ff4aac31a44f",
    taskSubject: "urn:agentic-task:5146fc2a68d407017e51f2065478d20f029371873ac7889719c0f4b74f2bbf48", publicKeyDigest: "4307a5023c78da542abfd96a23ccb87d71029ba69c8eeaa64c215e095b13a9f4", laneBindingDigest: "527b7f8f5761eb227692162b8f4e0db3fa9c0316b0c51a6782f094f3b184dda2", bindingMode: "claim", priorBindingDigest: null, bindingDigest: "1d838e7e0dee3207aa9a7fc4415a2f6c9f84891482644f69b909ab50490bfff5",
    integrationCommit: "a5cceab16c733b3ca412f06cbf43f536f3d66569", integrationTree: "df405c740512af47a1d92ff1a01d8f92b5795624", manifestDigest: "6789d8a6d91a4e0c54964da26f2780d576c0c701b03c184eeca2809c59255b1b", stagedDiffDigest: "03a1a6934b1bd631e97910b576576c91b0093e75547e24daf7106ca96b1ab49b", pathsDigest: "65ed7c7950b5a5998ef753c467a9efb1de8ad3b4a964e28dde9a7745f61a94f7", protectedRefresh: false }),
  fixedSubject({ pullRequest: 823, nodeId: "PR_kwDOSr5-fM8AAAABBhSAlA", branch: "agent/katrinas-macbook-pro.local/github-strong-conditional-pull-body",
    scope: "github-strong-conditional-pull-body", sessionId: "github-strong-conditional-pull-body-20260830t1809z", worktreeBasename: "github-strong-conditional-pull-body", localEpoch: 323,
    baseSha: "82bbe12e4eefca86752138647ea5f3ee4989cbd8", headSha: "9eef7de32a993cb685e8cd7431f07b4e86eb2c75", treeSha: "ddb9c1511bc5dc7531b536c3daa7a55c7a514cb9", mergeSha: "beab09739c62eb3fdd1bafa84ea15f9df192a778",
    sourceRawSha256: "d03aa5e7cc805e9007f51485d766109b29a1390f3965fb08458799d5b035a315", sourceRawBytes: 416, protectedRawSha256: "951a589ca824e7e9964f83967335bc650f87474593fc4c546fd817dbe026e704", protectedRawBytes: 620,
    reviewedRunId: 33328078682, postMainRunId: 33328213315, fenceSha: "f5949d25218694e273d7988dbb72ffa783376c6e", leaseIdentityDigest: "966a3c3b0b16404cf679ebcc02221d7dd892e0707b6b689e57b2c332d2d08001",
    claimId: "efed514f4dada45a0bc2becc88cc8d2035ba25404854ff56f49f0a8086863f01", claimDigest: "d1414fb4211b1483350939ccb959dc83fa522a509e774d72a7d15c5770e00666", cloudEpoch: 1, cloudTransition: 5, integrationReceiptDigest: "0e8c52b8f00e5c20a8d23cedb5877eb160cfc30079540a9e44d344f91f943f2d",
    taskSubject: "urn:agentic-task:925072b5bdfae0d81d1a115da48d2938b0abf4f5b825b62f835a3734a186f104", publicKeyDigest: "5cf089b3ce40571bb94dc6db8838c445301c60602a51fdb44162cbe598a4ef4f", laneBindingDigest: "7b177889526d8658d397f4c1cf46ab3060ae4c862c2d816dd8388d409410352a", bindingMode: "claim", priorBindingDigest: null, bindingDigest: "706b335ef355f94aa10371d66ff4ebfabc0de2447414e6466f72bc5b86280e0d",
    integrationCommit: "9eef7de32a993cb685e8cd7431f07b4e86eb2c75", integrationTree: "ddb9c1511bc5dc7531b536c3daa7a55c7a514cb9", manifestDigest: "dbb5190191f25223399ecf44402a657468638f64746bc6533544f8d00738d44b", stagedDiffDigest: "2c8db48b03065e56bb67528c8ba2526eec12b98a867a0b6669461e9b5b2d49be", pathsDigest: "caa6611bb2f24d3d4881e77dc9ab97ad8c5feac012c0c5391c36328af60c840c", protectedRefresh: false }),
  fixedSubject({ pullRequest: 824, nodeId: "PR_kwDOSr5-fM8AAAABBhax3A", branch: "agent/katrinas-macbook-pro.local/github-cooperative-pull-body-projection",
    scope: "github-cooperative-pull-body-projection", sessionId: "github-cooperative-pull-body-projection-20260830t1852z", worktreeBasename: "github-cooperative-pull-body-projection", localEpoch: 324,
    baseSha: "beab09739c62eb3fdd1bafa84ea15f9df192a778", headSha: "7de53c257fa20427d261b4702db038f3de7e789c", treeSha: "f920c595fff09abcfa114e8803d802d7d07a07cf", mergeSha: "c49dfb670ab3f2863d06098e45c742b68b1b13be",
    sourceRawSha256: "427970e2a5707fb95ca34d6e34753921c04d985077671b7fc2564ce484dd9ea3", sourceRawBytes: 436, protectedRawSha256: "f4e862d11eb54e7e16b54b5138887a609b199ceefd49b06124e7a5f36b109b7e", protectedRawBytes: 652,
    reviewedRunId: 33330412069, postMainRunId: 33330571646, fenceSha: "597f1bc5846b4f755ec71d796febf8c9256e8800", leaseIdentityDigest: "7b7ef99f1bba5a38b03c453eb49aac5be84140cfa0da6eb181c65aa7df67ada3",
    claimId: "80ee1583aae211bc0d70bfb3135f60b39131c61386d592be819c71d4d087f4e4", claimDigest: "aabd804cb92e2da13c4f029a6ab0f4e703e08c61828ac0a700cc26fb7dc0c3a8", cloudEpoch: 1, cloudTransition: 5, integrationReceiptDigest: "5cd11e5d9a473dfddc847bc93b8a95ba2651da466eef7b489beda78d32357552",
    taskSubject: "urn:agentic-task:af45f31fde017e6c714a39440c3fa11d5cb1005be413ad7fb853d7aa66baf373", publicKeyDigest: "540bf008c2b10c372de4ffd5c5cf27bda4606f00a2b7dd6d88061e02a0ff75f7", laneBindingDigest: "4fd26e52de4d857254b64cc3cd2a9cfe884ef84ed13fa62afb0786664f2a8901", bindingMode: "claim", priorBindingDigest: null, bindingDigest: "ee983324715a47e4a11e023b3789174f21edc0c88a88237711bfd3788fffbf2f",
    integrationCommit: "7de53c257fa20427d261b4702db038f3de7e789c", integrationTree: "f920c595fff09abcfa114e8803d802d7d07a07cf", manifestDigest: "2ac31db4bdef79ab8cbcff8424b29f604ce4f77b8feddd6ee452b8cc7d93c701", stagedDiffDigest: "bf6be9fa79fb3da4a8afb81a7ee4d07af4efef46d50e1988697e35335b6c83d8", pathsDigest: "40fffbedec7055c832bc9a020dfbccf4e036f344158f84239106d47b808a5a55", protectedRefresh: false }),
  fixedSubject({ pullRequest: 825, nodeId: "PR_kwDOSr5-fM8AAAABBhjICg", branch: "agent/katrinas-macbook-pro.local/active-dirt-marker-replay-order",
    scope: "active-dirt-marker-replay-order", sessionId: "active-dirt-marker-replay-order-20260831", worktreeBasename: "active-dirt-marker-replay-order", localEpoch: 325,
    baseSha: "c49dfb670ab3f2863d06098e45c742b68b1b13be", headSha: "c16dee29507a26cb0c8b2e8e6f9b9d80204e4a57", treeSha: "923db60469114a17f868a531c28e053a59df57e0", mergeSha: "ed7461e5b272da1cba4cd31c079e12259965eaf1",
    sourceRawSha256: "5f673b1dab17646caf8027cd4d49d9854b18ca58a5026b2e63e3ead0872c0c9c", sourceRawBytes: 406, protectedRawSha256: "002b2d122072889c90444258391321f031d3dfd0d14ea88d9969c676d8082fce", protectedRawBytes: 608,
    reviewedRunId: 33333212149, postMainRunId: 33333368242, fenceSha: "9786a35436664ff50b9f7a1e4b245d97595c071d", leaseIdentityDigest: "70c40ce68380a50ac50ca0eeb295eaad0d7fd6604aa93e9ce31021c7ccde6c9f",
    claimId: "390c05e2d09450494765b39a00d3338b9548a5914807ad91a2fa315babc93f28", claimDigest: "057d1caf3d2823f8632d8cf76b5620500180b70e667e04f26cdbd704cb08ad86", cloudEpoch: 1, cloudTransition: 5, integrationReceiptDigest: "c5c126eb152d240575a5339b11562da52519e7dcb3f101b5c291da9c84ead179",
    taskSubject: "urn:agentic-task:b9009b19d187bc4a3f4ab0ec3e7539b7cd6f40195bc1b9361ff608653614e8ac", publicKeyDigest: "ab645abc5fd87d42a23e4238eee5bef979b275d803bb2940531d5b7a21db4ab6", laneBindingDigest: "71822ceafa02cc0731e86d34c84c9f1506ec3d284604901c52ce6625f7765b8d", bindingMode: "claim", priorBindingDigest: null, bindingDigest: "361796d700e2aff98c0805892a73c40419e63bbc0d7b4764ff5e23342bd55949",
    integrationCommit: "c16dee29507a26cb0c8b2e8e6f9b9d80204e4a57", integrationTree: "923db60469114a17f868a531c28e053a59df57e0", manifestDigest: "2051856419bab664356415b0f1bb6ab30f78ce2f760b5726372481067949ff11", stagedDiffDigest: "b68429ff414cd5e3b8523e5d1c324537d04b7c4060f025c5677fe9551437392d", pathsDigest: "456513ed2c2530a506b410d7f765dbaf387a48fbf1b1d6a320d30dedb31c6d06", protectedRefresh: false }),
  fixedSubject({ pullRequest: 826, nodeId: "PR_kwDOSr5-fM8AAAABBh1GEw", branch: "agent/katrinas-macbook-pro.local/canonical-squash-pr818-attribution-recovery",
    scope: "canonical-squash-pr818-attribution-recovery", sessionId: "canonical-squash-pr818-attribution-recovery-20260831", worktreeBasename: "canonical-squash-pr818-attribution-recovery", localEpoch: 326,
    baseSha: "ef37a86ac7064c674a972d2afdd8e822ead7de69", headSha: "08cf277cc3c0566071b7f4567b9b2e4433774417", treeSha: "e1a210125de086c8ec92e88d40794dcac3d5e951", mergeSha: "ab6ef4ab22f8828ed37e51bc7a880befccb3cf77",
    sourceRawSha256: "a886ce91d95a1743a635492585e73f5cf182369cf84d9b2bd8c21bbf3bde0ff4", sourceRawBytes: 449, protectedRawSha256: "d4997cf98b4ddba78a5ceac52ad28dbfafc89d8251044174fe8faab426b9dc26", protectedRawBytes: 670,
    reviewedRunId: 33335928794, postMainRunId: 33336062186, fenceSha: "34053c89abefc71b359e00630186d0198278af2b", leaseIdentityDigest: "5087b5c64b6e0e4ba7becf744daa9d19c0c57529d4af84f14481c2509d712c5c",
    claimId: "1c55ad9fe42e1fe24805c4be264b08f9782b00d628640027d1c110e3cf47defe", claimDigest: "149642a31b30254193058250c72728e60e6bc66600e1cef774f280fe67b412d6", cloudEpoch: 1, cloudTransition: 5, integrationReceiptDigest: "44c21fad846e1319d856c9868a51dbf36b21a8c2375e6cb788b5a438d7ad51eb",
    taskSubject: "urn:agentic-task:2dfc4dfbec6d231e1fbc849bf43786f32ab0b5631e7126f356c1984d7b6a7851", publicKeyDigest: "2bb12ea61ecc593af19e138d27364f8777d1712c5886d287740d42cb140b63b5", laneBindingDigest: "6b586233221012ec7ece0fd1ecc4fc10b71bb5af4e62d0575387e907d2444944", bindingMode: "claim", priorBindingDigest: null, bindingDigest: "cd5c96ee14c4a632badeb01a82295b8d7e8f61a28c2823ec0f5849aca107551a",
    integrationCommit: "08cf277cc3c0566071b7f4567b9b2e4433774417", integrationTree: "e1a210125de086c8ec92e88d40794dcac3d5e951", manifestDigest: "7afbf04c83f9ea227f41b66104b2e8a18f7d50a5303bf311895fe1cc3b51ae9b", stagedDiffDigest: "75e9bab7018a9648101d1e9b0dc8b3852833c4a331983c4e82ba77c0ba831786", pathsDigest: "820e9d0757a02dea52185d996b484025b27bdacce9e8d0bbad233b2f60164892", protectedRefresh: false }),
  fixedSubject({ pullRequest: 828, nodeId: "PR_kwDOSr5-fM8AAAABBiH67w", branch: "agent/katrinas-macbook-pro.local/claim-only-waiting-bridge-live-topology",
    scope: "claim-only-waiting-bridge-live-topology", sessionId: "claim-only-waiting-bridge-live-topology-20260831", worktreeBasename: "claim-only-waiting-bridge-live-topology", localEpoch: 328,
    baseSha: "2329c600366e841a4e9d284d6cb291fff46884fe", headSha: "92261c3601eab6d33163328baa405cc2818c8009", treeSha: "0c94cb2e87407b41c0adf8a803ebafb2f87c437b", mergeSha: "04cd7f6b5f30ccc86095122bd1fabb3f20f2b7fa",
    sourceRawSha256: "cba9c4479bac4ac46376a7d54069d5e85d30fcb15e3f11629fbd92b77da4e79e", sourceRawBytes: 432, protectedRawSha256: "f0278def0285604a4a5b6e41088262d5353875c9f5dedaf1f37223b16b2a3f53", protectedRawBytes: 644,
    reviewedRunId: 33340720688, postMainRunId: 33340894786, fenceSha: "53bc1c3d016d38d6cbf353f7c4459fd1efbcd420", leaseIdentityDigest: "1e7dc5c7e20ab88788f2233d01455d276f2ef33468f37b9216b013e3f49ae68e",
    claimId: "e8f86e3bb992e90ff32c0d7a4be2afa8d1f0924c38f4eebd50ab9f762291f028", claimDigest: "19ba5faa01ca71597f69879623fe28c65847d4d097937a21b0da7a07d5e8e9e2", cloudEpoch: 1, cloudTransition: 6, integrationReceiptDigest: "b51fb07d523b34d32dc582584f549ba59399d8941ec2e564d1bf40e1c7370e70",
    taskSubject: "urn:agentic-task:463b881f2bd6a3061b4cc115804918c6b5ab7efdd0959998a1bc29bdd8afde5a", publicKeyDigest: "4a74fef1e62f106a5b4b7acb3a8f0a1ea64ce18e5ee67dd03182d4ef339d6b48", laneBindingDigest: "4ff693b50da0141ca64f7ae2d4af0dcc32984a0aaa2bfbc99d25d6be383c512c", bindingMode: "claim", priorBindingDigest: null, bindingDigest: "fad1c195976e79035427d3c25cf9766905844b880fb0003f4cf1c049f9857c7a",
    integrationCommit: "92261c3601eab6d33163328baa405cc2818c8009", integrationTree: "0c94cb2e87407b41c0adf8a803ebafb2f87c437b", manifestDigest: "8d6a40e616f475f58deb2fd146a2eaab909f0fc385d6787631196f474722ff5f", stagedDiffDigest: "7f4b1fad397c2a1fef1012c7318c6dbc5a4b9192a6fb54b40fbc0c487f917140", pathsDigest: "f21a8cd5194b6bb727a443b8d7fd33bed3fec8484690138c5b2abb89c093542f", protectedRefresh: false }),
]);
export const FIXED_TERMINAL_CLOUD = freeze([
  terminalCloud(818, 6, "0af9838a2bc9beef2ab8d59ff67d2961d2365c96eeed8c97b7aaf2d35a9f041e", "a0fa3b5de0d71b2d9acab3f54c8076490ed9aeba46bb9354733399870b1aa1e6", 5, 6451, "09acb98b70a635013623d9b236ae54bc3135d5cbf43214f62ded13ebc296b15d", "0cad99b24235d1b1c602d032461ee5036ebca8d5663cb6e4550c5d5cb39ca90f", "ed7a9fda5b05fca33a7f2c4f8560816862402a2db24973ff0140efab80b0980c", "8d265450c2095a65e1616c062b3068225236d22d20f379d636c74ab827d5f7a7", 6),
  terminalCloud(820, 6, "d2ad826e4d37f8ca35bcf699c76da3b78dbfa5e458030dc43fc73c2df8e3004e", "b3f7155c0b7825d374c23a204cde5c3ca2808b69184a29b52ac4174427954db2", 5, 6394, "e2c86128a48c6a0bdd1b575548f5271d88c50b429fe89ed5471db7b2a20221d2", "f7f87526cf28f588277b5d77dc4c08dadb4724c0fc0a67f7ae5ceac5145fd2a0", "6b43d4140e3cd0cf5ce8076efb9a69481f5e599c131cad3703d266100d4133a5", "78053c03d5faf59e52bf01e589e0261407896847942a1b48834cf05680d430ba", 6),
  terminalCloud(822, 6, "47bbbeb3357d1431ef796a6903a09aab95c9cf3791f9a2dce0976b34c574cb10", "f0c1b0c8231deb2ad2b7a4b66372207dbb63c4467095fc519e0447239b75f359", 5, 6419, "cbff242d3d350e9ccdbaa9d5877b0dc5a54af161c2c6ed32a26baad189503e3c", "2b4d02bb5a36871f738f2ab58ec42c6a3e038629e2652658c9a0c91945fa0853", "0873a705d409fc00feb0801eae9739e1fdd1b12281864912833c513d2e2f1409", "e85191bab7dde6d2a33b6eefbe5563be5d2ee5c3932a8c282aacaa891392ec5b", 6),
  terminalCloud(823, 6, "a469a81ebe321d65abe965f310b940e23f68ee0033fc123608224f032487e9fd", "f4c530c8bd8ffadf60037448e901a5975ab41c416ca5be6a32ce49fd1f2160aa", 5, 6431, "50987c0d11d627d861bf864abdd84fb6c72f3f087065e3d662d8eab2b9dc92db", "8d8680c867dd6884480a6405a0d41fd5ce601029f8c68a102af6316813f81ebc", "8f277c61598a14025c91643414241496e027a401cc93a0b46d21e00be103ece5", "f26deb8c2c5cf95b9136759743c671869be84d4a7eb07642bda26ca8d7fb6d0a", 6),
  terminalCloud(824, 6, "0117d45fdd332d1ce5580cbb40018759a6614b2f1a3d8eb4c938ae451996da10", "223a5bd3221951e36353d72d4efe11006a41828e2ce4418a62c88061398ce3e4", 5, 6438, "3d66151287d99509f7a88a208e0ea66717aa9d2400a42249af1ffe4ebf72ec94", "4b4c23cd56fa925da1d07a06db4ad8635a09adf60f638bf4016dc4974392988f", "ee408b15cdd451adff7f250edd8c56759a196efc2b8d54dd2cbe73c1fe5f0184", "8cdfc009f8ca57d2cbe6b108d391188a30c18f7b45e74d3bcd391fa6c14871f6", 6),
  terminalCloud(825, 6, "60aec854b0d68ada18e04c0af2c43d8f23ba964651524a751df942a173495965", "f4a1bc7744114bc6a056b85781f5163818aee03126f24b1b2133ca9631bb36d1", 5, 6444, "4b0284039cf51c8c7e89a2790e7bc692f63237962cbdc102f03949d51d735df8", "6b48bcbad3bfc819b1c028c6e1717aec1f181023a0d0fd7082367341f1ee0306", "e8e3ce74ca9aa0e4f7bcb7c756e3b5d7ab3525a6f78db1c4c68e662eac400e11", "b745128c4763767c55511e6378c996d13c550f55688eb4a2391debbcdb2ef1d3", 6),
  terminalCloud(826, 6, "a193ece28ede195809deabe751cc181f760bd9d286dd0bce04ec3c40db279391", "abab6ff6710d3a4e2f43768bf0114f4b9b294c2e56e4974078ba1d6b30a2e96c", 5, 6458, "635dbac72b91e5d37e0b587d70e1d3ab69f4fdeb2edf82cb9222bec7799fbc76", "ce7de854b8eaa8ca36d917cd20065058f06e52633868f6a7148e4b056783182c", "ca96e0f43296f7030e16d9626a47717bcb586a10cae8b819e06972f16bdee491", "2a8e8074d7598f0d6056c2a0cdb0a00804bc682fc9da4b29c240833c681af85b", 6),
  terminalCloud(828, 7, "3f5be9d08a6594c48d0a2ba721e4d31337f652bf1beaa564852c0daadb4cf75c", "64ce34f9c19979691e63a9536d3f398c88d8625efbd2fad5070e6313f9abb717", 6, 6473, "d9b30030179fdfac2db79cf38e757538c6271448d39cecdb5fcf32cc883835a6", "4a61c9b14523f0ec5c7f3556d5eb687aa97d97e94e4c4da80fe1812b6eb1dd9c", "fcb0e76f4c260c9105a787d846004dc976bda1f8ab476cbf8a2eacfe8bc07d07", "7b4c2b7e6287998e541e3b7f971d375616d50f8264020a81968efc16fe2c59a9", 7),
]);
export const INSTALL_PATHS = Object.freeze([
  "__tests__/canonical-squash-batch-terminalizer-v2.test.mjs",
  "docs/CANONICAL-SQUASH-BATCH-TERMINALIZER-V2.md",
  "scripts/canonical-squash-batch-terminalizer-v2-contract.mjs",
  "scripts/canonical-squash-batch-terminalizer-v2-controller.mjs",
  "scripts/canonical-squash-batch-terminalizer-v2-repository-adapter.mjs",
  "scripts/canonical-squash-batch-terminalizer-v2.mjs",
]);
export const ITEM_PHASES = Object.freeze([
  "pending",
  "evidence-verified",
  "retirement-adoption-intent",
  "retirement-adopted",
  "completion-intent",
  "completion-projected",
  "terminal-verified",
  "complete",
]);
export const FORBIDDEN_EFFECTS = Object.freeze([
  "authored-source-write",
  "authored-branch-write",
  "pull-request-write",
  "auto-merge-write",
  "new-cloud-claim",
  "cloud-retirement",
  "cloud-ledger-write",
  "runtime",
  "worktree-cleanup",
  "branch-delete",
  "release",
  "deployment",
]);

export function sealBatchEvidence(value) {
  const core = normalizeEvidenceCore(value);
  const stableDigest = digestValue(stableEvidenceProjection(core));
  const sealed = { ...core, stableDigest };
  return freeze({ ...sealed, evidenceDigest: digestValue(sealed) });
}

export function normalizeBatchEvidence(value) {
  object(value, "batch evidence");
  const core = without(value, ["stableDigest", "evidenceDigest"]);
  const rebuilt = sealBatchEvidence(core);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("evidence seal");
  return rebuilt;
}

export function buildBatchPlan(evidence) {
  const normalized = normalizeBatchEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    subjects: [...FIXED_PULL_REQUESTS],
    evidence: normalized,
    effects: ["adopt-exact-integrated-retirement", "project-local-completion-ready"],
    execution: "serial-monotonic-no-rollback",
    continuation: "ordinary-unchanged-session-device:integrate",
    forbiddenEffects: [...FORBIDDEN_EFFECTS],
  };
  const planDigest = digestValue(core);
  return freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeBatchPlan(value) {
  object(value, "batch plan");
  const rebuilt = buildBatchPlan(value.evidence);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan drift");
  return rebuilt;
}

export function authorizeBatchPlan(plan, authorization) {
  const normalized = normalizeBatchPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return digestValue({
    operation: OPERATION,
    planDigest: normalized.planDigest,
    authorization,
  });
}

 function normalizeEvidenceCore(value) {
  object(value, "batch evidence core");
  keys(value, ["schema", "observedMainSha", "ledger", "controller", "bridge", "items"],
    "batch evidence core");
  if (value.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  sha(value.observedMainSha, "observed main");
  const ledger = normalizeLedger(value.ledger);
  const controller = normalizeController(value.controller);
  const bridge = normalizeBridge(value.bridge);
  if (!Array.isArray(value.items) || value.items.length !== FIXED_PULL_REQUESTS.length) {
    invalid("evidence items");
  }
  const items = value.items.map((item, index) => normalizeItem(item, FIXED_SUBJECTS[index]));
  requireDistinct(items, bridge);
  return freeze({
    schema: EVIDENCE_SCHEMA,
    observedMainSha: value.observedMainSha,
    ledger,
    controller,
    bridge,
    items,
  });
}

function normalizeLedger(value) {
  object(value, "ledger evidence");
  keys(value, ["repository", "revision", "ledgerDigest"], "ledger evidence");
  if (value.repository !== "huijoohwee/agentic-canvas-os") invalid("ledger repository");
  sha(value.revision, "ledger revision");
  digest(value.ledgerDigest, "ledger digest");
  return freeze(structuredClone(value));
}

function normalizeController(value) {
  object(value, "controller evidence");
  keys(value, ["repository", "revision", "treeSha", "installBlobs"], "controller evidence");
  required(value.repository, "controller repository");
  sha(value.revision, "controller revision");
  sha(value.treeSha, "controller tree");
  if (!Array.isArray(value.installBlobs)
    || canonicalJson(value.installBlobs.map(entry => entry?.path))
      !== canonicalJson(INSTALL_PATHS)) invalid("controller install paths");
  const installBlobs = value.installBlobs.map(entry => {
    keys(entry, ["path", "blobSha"], "controller blob");
    sha(entry.blobSha, "controller blob SHA");
    return structuredClone(entry);
  });
  return freeze({ ...structuredClone(value), installBlobs });
}

function normalizeBridge(value) {
  object(value, "bridge evidence");
  keys(value, [
    "pullRequest", "nodeId", "url", "branch", "scope", "sessionId", "epoch",
    "baseSha", "autoMergeDigest",
    "sourceHeadSha", "sourceTreeSha", "mergeSha", "mergeTreeSha",
    "sourceCommitDigest", "protectedCommitDigest", "messageClassificationDigest",
    "installDeltaDigest", "leaseIntegrationDigest", "worktreePath", "completedLeaseDigest",
    "authoritySubjectId", "publicKeyDigest", "taskAuthorityBindingDigest", "claimId",
    "terminalCloudDigest", "completionMainSha", "cleanupOperationId",
    "worktree", "registration", "branchRef", "controllerContained",
  ], "bridge evidence");
  if (value.pullRequest !== 839
    || value.branch !== "agent/katrinas-macbook-pro.local/canonical-squash-batch-terminalizer-v2"
    || value.scope !== "canonical-squash-batch-terminalizer-v2"
    || value.sessionId !== "canonical-squash-batch-terminalizer-v2-20260831"
    || value.epoch !== 338) {
    invalid("exact self-hosted bridge identity");
  }
  if (value.url !== "https://github.com/huijoohwee/agentic-canvas-os/pull/839"
    || typeof value.nodeId !== "string" || !value.nodeId
    || typeof value.authoritySubjectId !== "string" || !value.authoritySubjectId
    || typeof value.worktreePath !== "string"
    || value.worktreePath.split("/").at(-1) !== "canonical-squash-batch-terminalizer-v2"
    || value.sourceTreeSha !== value.mergeTreeSha) invalid("bridge joined identity");
  for (const name of ["baseSha", "sourceHeadSha", "sourceTreeSha", "mergeSha",
    "mergeTreeSha", "completionMainSha"]) {
    sha(value[name], `bridge ${name}`);
  }
  for (const name of [
    "autoMergeDigest", "sourceCommitDigest", "protectedCommitDigest",
    "messageClassificationDigest", "installDeltaDigest", "leaseIntegrationDigest",
    "completedLeaseDigest", "publicKeyDigest", "taskAuthorityBindingDigest",
    "claimId", "terminalCloudDigest", "cleanupOperationId",
  ]) digest(value[name], `bridge ${name}`);
  if (value.worktree !== "absent" || value.registration !== "absent"
    || value.branchRef !== "preserved" || value.controllerContained !== true) {
    invalid("bridge completed-and-cleaned anchor");
  }
  return freeze(structuredClone(value));
}

function normalizeItem(value, fixed) {
  return normalizeV2EvidenceItem(value, fixed, {
    terminalCloud: FIXED_TERMINAL_CLOUD.find(row => row.pullRequest === fixed.pullRequest),
  });
}

export function classifyV2ProtectedMessage({ sourceMessage, protectedMessage,
  sourceHistorySubjects, sourceAuthors, autoMergeRequest, mergedBy } = {}) {
  const managed = parseManagedMessage(sourceMessage);
  if (!Array.isArray(sourceHistorySubjects) || sourceHistorySubjects.length !== 2
    || sourceHistorySubjects.at(-1) !== managed.headline) {
    throw new Error("Protected message source history is invalid.");
  }
  const authors = uniqueAuthors(sourceAuthors);
  const provider = normalizeProviderCause(autoMergeRequest, managed, mergedBy);
  if (provider.commitBody !== null) throw new Error("Provider squash body is not exact null.");
  const bullets = sourceHistorySubjects.map(subject => `* ${subject}`).join("\n\n");
  const trailers = authors.map(author =>
    `Co-authored-by: ${author.name} <${author.email}>`).join("\n");
  const expected = `${managed.headline}\n\n${bullets}\n\n${managed.body}\n\n---------\n\n${trailers}`;
  if (protectedMessage !== expected) {
    throw new Error("Provider attribution rewrite is not byte-exact.");
  }
  return freeze({ sourceKind: "managed-exact",
    protectedKind: "provider-attribution-rewrite", renderedMessageDigest: digestValue(expected),
    providerCauseDigest: digestValue(provider),
    sourceHistoryDigest: digestValue(sourceHistorySubjects),
    authorAttributionDigest: digestValue(authors) });
}

export function assertV2ImmutableLease(lease, evidence) {
  const fixed = Object.hasOwn(evidence, "pullRequest") && typeof evidence.pullRequest === "number"
    ? evidence : FIXED_SUBJECTS.find(item => item.pullRequest === evidence.pullRequest.number);
  if (!fixed || !["delivery", "completing", "completed"].includes(lease?.status)) {
    throw new Error("Subject lease identity is unavailable.");
  }
  const { projection, binding } = projectV2ImmutableLease(lease);
  const identity = digestValue(projection);
  if (identity !== fixed.leaseIdentityDigest || binding.bindingDigest !== fixed.bindingDigest
    || binding.bindingMode !== fixed.bindingMode
    || binding.priorBindingDigest !== fixed.priorBindingDigest) {
    throw new Error(`PR ${fixed.pullRequest} immutable lease/task identity drifted.`);
  }
  if (evidence.pullRequest?.number && (lease.branch !== evidence.branch
    || lease.worktreePath !== evidence.worktreePath
    || digestValue(lease.cloudAuthority) !== evidence.lease.cloudAuthorityDigest)) {
    throw new Error(`PR ${fixed.pullRequest} sealed lease projection drifted.`);
  }
  return binding;
}

export function projectV2ImmutableLease(lease) {
  const baseKeys = ["acquiredAt", "admission", "autoDelivery", "baseSha", "branch",
    "cloudAuthority", "deliveryHeadSha", "device", "epoch", "expiresAt", "fenceSha",
    "heartbeatAt", "integration", "pullRequestUrl", "runtimeRequired", "schema", "scope",
    "sessionId", "status", "taskAuthority", "worktreePath"];
  const present = SUCCESSOR_FIELDS.filter(name => Object.hasOwn(lease, name));
  const expected = [...baseKeys, ...(lease.status === "delivery" ? [] : ["completion"]),
    ...(present.length ? SUCCESSOR_FIELDS : [])].sort();
  if (![0, SUCCESSOR_FIELDS.length].includes(present.length)
    || canonicalJson(Object.keys(lease).sort()) !== canonicalJson(expected)) {
    throw new Error("Subject lease key set drifted from its exact delivery lineage.");
  }
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const projection = Object.fromEntries(LEASE_PROJECTION_FIELDS.map(name => [name,
    NULL_LEASE_FIELDS.has(name) ? lease[name] ?? null : structuredClone(lease[name])]));
  projection.taskAuthority = binding;
  projection.successorLineage = present.length ? Object.fromEntries(
    SUCCESSOR_FIELDS.map(name => [name, structuredClone(lease[name])])) : null;
  return { projection: Object.freeze(projection), binding };
}

export function classifyIntegratedRetirement(snapshot, { claimId, finalRevision,
  reviewRequestId, integratedClaimDigest, integrationReceiptDigest }) {
  const lineage = snapshot.value.entries.filter(entry => entry.claimId === claimId);
  const integrate = lineage.at(-2); const terminal = lineage.at(-1);
  if (integrate?.action !== "integrate" || integrate.claimDigest !== integratedClaimDigest
    || integrate.claimCore?.state !== "integrated-preserved"
    || integrate.claimCore?.reviewRequestId !== reviewRequestId
    || integrate.claimCore?.integrationReceiptDigest !== integrationReceiptDigest
    || terminal?.action !== "retire" || terminal.parentDigest !== integrate.digest
    || terminal.claimCore?.state !== "retired"
    || terminal.claimCore?.retirement?.reason !== "integrated"
    || terminal.claimCore.retirement.finalRevision !== finalRevision
    || terminal.claimCore.retirement.reviewRequestId !== reviewRequestId
    || terminal.claimCore.retirement.integrationReceiptDigest !== integrationReceiptDigest
    || terminal.claimCore.transitionCounter !== integrate.claimCore.transitionCounter + 1) {
    throw new Error("Bridge cloud claim is not exact integrated retirement.");
  }
  return freeze({ terminalCloudDigest: digestValue({ claimId,
    lineageLength: lineage.length, lineageDigest: digestValue(lineage),
    integrateEntryDigest: integrate.digest, integratedClaimDigest,
    terminalEntryDigest: terminal.digest, terminalClaimDigest: terminal.claimDigest,
    integrationReceiptDigest, state: "retired" }) });
}

function parseManagedMessage(value) {
  if (typeof value !== "string") throw new Error("Managed source message is invalid.");
  const lines = value.split("\n");
  if (lines.length !== 8 || lines[1] !== "" || lines[3] !== ""
    || lines[4] !== lines[5].replace("Agentic-Scope:", "Agentic-Task:")
    || !/^Agentic-Task: [a-z0-9-]+$/u.test(lines[4])
    || !/^Agentic-Lease-Epoch: [1-9][0-9]*$/u.test(lines[6])
    || lines[7] !== "Agentic-Mechanism: Agentic Canvas OS protected integration") {
    throw new Error("Source message is not exact managed form.");
  }
  const scope = lines[4].slice("Agentic-Task: ".length);
  const sentence = `Integrate the declared ${scope} change through its protected managed task lane so downstream policy can attribute the change to its writer lease.`;
  if (!lines[0] || lines[2] !== sentence) throw new Error("Managed source body is invalid.");
  return freeze({ headline: lines[0], body: lines.slice(2).join("\n") });
}

function normalizeProviderCause(value, managed, mergedBy) {
  if (!value || value.mergeMethod !== "SQUASH" || value.commitHeadline !== managed.headline
    || value.enabledBy?.login !== mergedBy || value.enabledBy?.isBot !== false) {
    throw new Error("Squash provider cause is invalid.");
  }
  return freeze({ mergeMethod: value.mergeMethod, commitHeadline: value.commitHeadline,
    commitBody: value.commitBody, enabledAt: value.enabledAt,
    enabledBy: freeze(structuredClone(value.enabledBy)) });
}

function uniqueAuthors(values) {
  if (!Array.isArray(values)) throw new Error("Source author inventory is invalid.");
  const seen = new Set(); const result = [];
  for (const value of values) {
    if (!value || typeof value.name !== "string" || typeof value.email !== "string"
      || /[\r\n<>]/u.test(value.name) || /[\r\n<>]/u.test(value.email)) {
      throw new Error("Source author identity is invalid.");
    }
    const key = `${value.name}\0${value.email}`;
    if (!seen.has(key)) { seen.add(key); result.push({ name: value.name, email: value.email }); }
  }
  return freeze(result);
}

 function stableEvidenceProjection(evidence) {
  return {
    schema: evidence.schema,
    controller: evidence.controller,
    bridge: evidence.bridge,
    items: evidence.items,
  };
}

function requireDistinct(items, bridge) {
  const fields = [
    ["pull request", item => String(item.pullRequest.number)],
    ["branch", item => item.branch],
    ["worktree", item => item.worktreePath],
    ["claim", item => item.cloud.claimId],
    ["task authority", item => item.taskAuthority.authoritySubjectId],
    ["task binding", item => item.taskAuthority.bindingDigest],
    ["task public key", item => item.taskAuthority.publicKeyDigest],
  ];
  for (const [label, select] of fields) {
    const values = items.map(select);
    if (new Set(values).size !== values.length) invalid(`distinct ${label} identities`);
  }
  if (items.some(item => item.pullRequest.number === bridge.pullRequest
    || item.branch === bridge.branch || item.worktreePath === bridge.worktreePath
    || item.cloud.claimId === bridge.claimId
    || item.taskAuthority.authoritySubjectId === bridge.authoritySubjectId
    || item.taskAuthority.publicKeyDigest === bridge.publicKeyDigest
    || item.taskAuthority.bindingDigest === bridge.taskAuthorityBindingDigest)) {
    invalid("bridge identity must be distinct from subjects");
  }
}

 function fixedSubject(value) {
  const message = MESSAGE_IDENTITIES[value.pullRequest];
  const runs = RUN_IDENTITIES[value.pullRequest];
  const runMeta = RUN_METADATA[value.pullRequest];
  if (!message || !runs || !runMeta) invalid("fixed identity inventory");
  const refreshDelta = value.pullRequest === 818 ? [
    ["A", "__tests__/canonical-squash-attribution-recovery-terminalization.test.mjs", "3d4adddfcd4e6c34bce538190a85efa175da7b43"],
    ["A", "docs/CANONICAL-SQUASH-ATTRIBUTION-RECOVERY-TERMINALIZATION.md", "b81dc6b70448fe86369e1182f723005e798fdc91"],
    ["A", "scripts/canonical-squash-attribution-recovery-terminalization-contract.mjs", "5b0b1b85184e461ebd22698333d4d608ee4c6339"],
    ["A", "scripts/canonical-squash-attribution-recovery-terminalization-controller.mjs", "ec1bbaca7bd7af9d29bc3b4b6e0351c106fa2640"],
    ["A", "scripts/canonical-squash-attribution-recovery-terminalization-repository-adapter.mjs", "7713bccce4bea926967f1e34369ef79251241861"],
    ["A", "scripts/canonical-squash-attribution-recovery-terminalization.mjs", "7d1a66d3da01fe68c3e67d9a5175ab354f32e072"],
  ] : null;
  value = {
    ...value,
    sourceParentShas: value.pullRequest === 818
      ? ["feddc30a5e24f7bd602bb8d7bf8720c0f544a9be", value.baseSha] : [value.fenceSha],
    sourceMessageDigest: message[0], protectedMessageDigest: message[1],
    integrationMessageDigest: digestValue(HEADLINES[value.pullRequest]),
    autoMergeDigest: message[2], providerCauseDigest: message[2],
    sourceHistoryDigest: message[3], authorAttributionDigest: message[4],
    sourceVerificationDigest: SOURCE_VERIFICATION_DIGEST,
    protectedVerificationDigest: message[5],
    reviewedJobsDigest: runs[0], reviewedRunEvidenceDigest: runs[1],
    reviewedJobIds: runs[2], postMainJobsDigest: runs[3],
    postMainRunEvidenceDigest: runs[4], postMainJobIds: runs[5],
    reviewedRunNodeId: runMeta[0], reviewedCheckSuiteId: runMeta[1],
    reviewedRunNumber: runMeta[2], postMainRunNodeId: runMeta[3],
    postMainCheckSuiteId: runMeta[4], postMainRunNumber: runMeta[5],
    protectedRefreshTopology: refreshDelta === null ? null : {
      authoredSha: "feddc30a5e24f7bd602bb8d7bf8720c0f544a9be",
      authoredTreeSha: "c68b1dd8726093ea89509703e7cf9fa47c6ad9ce",
      authoredParentSha: "8d75cdd83d3c188c9fa1ddc360ec7e8d560284a9",
      reviewedSha: value.headSha, reviewedTreeSha: value.treeSha,
      reviewedParentShas: ["feddc30a5e24f7bd602bb8d7bf8720c0f544a9be", value.baseSha],
      delta: refreshDelta,
    },
  };
  for (const name of [
    "baseSha", "headSha", "treeSha", "mergeSha", "fenceSha",
    "integrationCommit", "integrationTree",
  ]) sha(value[name], `fixed subject ${name}`);
  for (const name of [
    "sourceRawSha256", "protectedRawSha256", "leaseIdentityDigest", "claimId",
    "claimDigest", "integrationReceiptDigest", "publicKeyDigest", "laneBindingDigest",
    "bindingDigest", "manifestDigest", "stagedDiffDigest", "pathsDigest", "autoMergeDigest",
    "sourceMessageDigest", "protectedMessageDigest", "integrationMessageDigest",
    "providerCauseDigest",
    "sourceHistoryDigest", "authorAttributionDigest", "sourceVerificationDigest",
    "protectedVerificationDigest", "reviewedJobsDigest", "reviewedRunEvidenceDigest",
    "postMainJobsDigest", "postMainRunEvidenceDigest",
  ]) digest(value[name], `fixed subject ${name}`);
  if (value.priorBindingDigest !== null) {
    digest(value.priorBindingDigest, "fixed subject prior binding");
  }
  for (const name of [
    "pullRequest", "localEpoch", "sourceRawBytes", "protectedRawBytes",
    "reviewedRunId", "postMainRunId", "cloudEpoch", "cloudTransition",
    "reviewedCheckSuiteId", "reviewedRunNumber", "postMainCheckSuiteId",
    "postMainRunNumber",
  ]) positive(value[name], `fixed subject ${name}`);
  for (const name of [
    "nodeId", "branch", "scope", "sessionId", "worktreeBasename", "taskSubject",
    "reviewedRunNodeId", "postMainRunNodeId",
  ]) required(value[name], `fixed subject ${name}`);
  if (!["claim", "continuation"].includes(value.bindingMode)
    || typeof value.protectedRefresh !== "boolean") invalid("fixed subject mode");
  if (!Array.isArray(value.sourceParentShas) || value.sourceParentShas.length < 1
    || !Array.isArray(value.reviewedJobIds) || value.reviewedJobIds.length !== 11
    || !Array.isArray(value.postMainJobIds) || value.postMainJobIds.length !== 11) {
    invalid("fixed subject sequence inventory");
  }
  value.sourceParentShas.forEach(candidate => sha(candidate, "fixed source parent"));
  [...value.reviewedJobIds, ...value.postMainJobIds].forEach(candidate =>
    positive(candidate, "fixed job id"));
  return freeze(value);
}
function terminalCloud(pullRequest, lineageLength, lineageDigest, integrateEntryDigest,
  integrationCounter, retireSequence, retireIdempotencyKey, retireRequestDigest,
  terminalEntryDigest, terminalClaimDigest, terminalCounter) {
  for (const [name, value] of Object.entries({
    lineageDigest, integrateEntryDigest, retireIdempotencyKey, retireRequestDigest,
    terminalEntryDigest, terminalClaimDigest,
  })) digest(value, `fixed terminal cloud ${name}`);
  for (const [name, value] of Object.entries({
    pullRequest, lineageLength, integrationCounter, retireSequence, terminalCounter,
  })) positive(value, `fixed terminal cloud ${name}`);
  return freeze({ pullRequest, lineageLength, lineageDigest, integrateEntryDigest,
    integrationCounter, retireSequence, retireIdempotencyKey, retireRequestDigest,
    terminalEntryDigest, terminalClaimDigest, terminalCounter });
}
function without(value, names) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => !names.includes(name)));
}
function keys(value, expected, label) {
  object(value, label);
  if (canonicalJson(Object.keys(value)) !== canonicalJson(expected)) {
    invalid(`${label} key set or order`);
  }
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function positive(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Canonical squash batch ${label} is invalid.`);
}
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}
