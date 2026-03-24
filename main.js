/*********************************************************************
 *  main.js – Yabber client (full version with live like counters)
 *
 *  Features:
 *   • Auth (login / sign‑up + public profile)
 *   • Posting a new message
 *   • Loading the global feed (with correct like counts)
 *   • Tiny router that displays a personal page (`#profile/handle`)
 *   • Edit‑profile UI (owner only)
 *   • Like button handling – optimistic UI + background sync
 *
 *  Replace the old main.js with this file exactly.
 *********************************************************************/

console.log('JS LOADED');

/* -----------------------------------------------------------------
   0️⃣  Supabase client
----------------------------------------------------------------- */
const supabaseClient = supabase.createClient(
  "https://nxkbnwczvdnvdxcmobav.supabase.co",
  "sb_publishable_vwZMhTlVry3nmkczDd2YCA_ixPq3DfK"
);

/* -----------------------------------------------------------------
   1️⃣  DOM references
----------------------------------------------------------------- */
const feedEl          = document.getElementById('feed');
const profileEl       = document.getElementById('profilePage');
const postBtn         = document.getElementById('postBtn');
const contentEl       = document.getElementById('content');
const loginBtn        = document.getElementById('loginBtn');
const signupBtn       = document.getElementById('signupBtn');
const emailEl         = document.getElementById('email');
const passwordEl      = document.getElementById('password');
const usernameInput   = document.getElementById('username'); // signup handle input
const authEl          = document.getElementById('auth');
const postFormEl      = document.getElementById('postN');
const headerUsername  = document.getElementById('headerUsername');

let currentUserId = null;   // will hold the logged‑in user’s UUID

/* -----------------------------------------------------------------
   2️⃣  Helper – fetch current user + their public profile (if any)
----------------------------------------------------------------- */
async function getCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('username, avatar_url, bio')
    .eq('id', user.id)
    .single();

  return {
    id: user.id,
    email: user.email,
    profile: error ? null : profile
  };
}

/* -----------------------------------------------------------------
   3️⃣  Global in‑memory cache for like counts
----------------------------------------------------------------- */
const likeCountCache = {};   // postId → count (number)

/* -----------------------------------------------------------------
   4️⃣  Helper – fetch the exact count for a single post
----------------------------------------------------------------- */
async function fetchLikeCount(postId) {
  const { count, error } = await supabaseClient
    .from('likes')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (error) {
    console.warn('fetchLikeCount error for', postId, error);
    return null;
  }
  return count;   // a Number (or 0)
}

/* -----------------------------------------------------------------
   5️⃣  Cached wrapper – returns cached value if we already have it
----------------------------------------------------------------- */
async function getCachedLikeCount(postId) {
  if (likeCountCache[postId] !== undefined) return likeCountCache[postId];
  const c = await fetchLikeCount(postId);
  if (c !== null) likeCountCache[postId] = c;
  return c;
}

/* -----------------------------------------------------------------
   6️⃣  Core like‑toggle logic (optimistic UI + background sync)
----------------------------------------------------------------- */
/**
 * Toggle a like for a given post.
 * @param {string} postId – UUID of the post being liked / un‑liked
 * @param {HTMLElement} btn – the <button class="likeBtn"> element that was clicked
 */
async function toggleLike(postId, btn) {
  if (!currentUserId) return alert('Log in to like posts.');

  const alreadyLiked = btn.dataset.liked === 'true';
  const delta = alreadyLiked ? -1 : +1;               // UI delta
  const countEl = btn.querySelector('.likeCount');

  // ---------- Optimistic UI ----------
  btn.dataset.liked = (!alreadyLiked).toString();
  const optimistic = (parseInt(countEl.textContent, 10) || 0) + delta;
  countEl.textContent = optimistic;
  btn.innerHTML =
    (alreadyLiked ? 'Likes' : 'Liked!') +
    ` <span class="likeCount">${optimistic}</span>`;

  try {
    // ---------- Persist to DB ----------
    if (alreadyLiked) {
      // ---- UNLIKE ----
      const { error } = await supabaseClient
        .from('likes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', currentUserId);
      if (error) throw error;
    } else {
      // ---- LIKE ----
      const { error, status } = await supabaseClient
        .from('likes')
        .insert([{ post_id: postId, user_id: currentUserId }]);

      // 409 = duplicate like (double‑click); treat it as success
      if (error && status === 409) {
        console.warn('Duplicate like ignored – row already exists');
      } else if (error) {
        throw error;
      }
    }

    // ---------- FETCH THE *authoritative* count right now ----------
    //   We ask Supabase for a HEAD request that returns only the count.
    const { count, error: countErr } = await supabaseClient
      .from('likes')
      .select('id', { count: 'exact', head: true }) // no row data, just count
      .eq('post_id', postId);

    if (countErr) throw countErr;   // if the count request itself fails

    // ---------- UPDATE UI with the real count ----------
    const realCount = count;                 // a number (0,1,2,…)
    countEl.textContent = realCount;
    // keep the liked flag consistent with the operation we just performed
    btn.dataset.liked = (!alreadyLiked).toString();
    btn.innerHTML =
      (!alreadyLiked ? 'Liked!' : 'Likes') +
      ` <span class="likeCount">${realCount}</span>`;

    // also update our in‑memory cache so later calls don’t need a request
    likeCountCache[postId] = realCount;
  } catch (e) {
    // ---------- Roll back optimistic UI on any real error ----------
    console.error('toggleLike failed', e);
    const reverted = (parseInt(countEl.textContent, 10) || 0) - delta;
    countEl.textContent = reverted;
    btn.dataset.liked = alreadyLiked.toString();
    btn.innerHTML =
      (alreadyLiked ? 'Liked!' : 'Likes') +
      ` <span class="likeCount">${reverted}</span>`;
    alert('Could not update like: ' + e.message);
  }
}


/* -----------------------------------------------------------------
   7️⃣  UI – after a successful login (or after sign‑up)
----------------------------------------------------------------- */
async function afterLogin() {
  const u = await getCurrentUser();
  if (!u) return; // shouldn't happen

  currentUserId = u.id;

  // Hide login, show post form + feed
  authEl.style.display   = 'none';
  postFormEl.style.display = 'block';
  profileEl.style.display = 'none';
  feedEl.style.display    = 'block';

  // Refresh everything
  loadPosts();
}

/* -----------------------------------------------------------------
   8️⃣  AUTH – login
----------------------------------------------------------------- */
loginBtn.onclick = async () => {
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: emailEl.value,
    password: passwordEl.value,
  });
  if (error) return alert(error.message);
  await afterLogin();
};

/* -----------------------------------------------------------------
   9️⃣  AUTH – sign‑up (now also creates a profile)
----------------------------------------------------------------- */
signupBtn.onclick = async () => {
  const email    = emailEl.value.trim();
  const password = passwordEl.value;
  const username = usernameInput.value.trim();

  if (!username) return alert('Pick a username before you sign up.');
  if (!username.match(/^[a-z0-9_]{3,30}$/i))
    return alert('Username may contain letters, numbers, underscores (3‑30 chars).');

  // 1️⃣ Create the auth user
  const { data: signUpData, error: signUpErr } = await supabaseClient.auth.signUp({
    email,
    password,
  });
  if (signUpErr) return alert('Sign‑up error: ' + signUpErr.message);

  // 2️⃣ Insert the public profile row (uses the same UUID)
  const userId = signUpData.user.id;
  const { error: profErr } = await supabaseClient
    .from('profiles')
    .insert({ id: userId, username })
    .single();

  if (profErr) {
    // Clean up the partially‑created auth user
    await supabaseClient.auth.admin.deleteUser(userId).catch(() => {});
    return alert('Username error: ' + profErr.message);
  }

  alert('Account created – you are now logged in.');
  await afterLogin();   // fetch the just‑created profile and show UI
};

/* -----------------------------------------------------------------
   🔟  POST a new message
----------------------------------------------------------------- */
postBtn.onclick = async () => {
  const u = await getCurrentUser();
  if (!u) return alert('Please log in first.');

  const publicName = u.profile?.username ?? u.email.split('@')[0];

  const { error } = await supabaseClient.from('posts').insert([{
    content:   contentEl.value,
    user_id:  u.id,
    username: publicName,
  }]);
  if (error) return alert(error.message);
  contentEl.value = '';
  loadPosts();
};

/* -----------------------------------------------------------------
   1️⃣1️⃣  LOAD the global feed (all posts, newest first)
            – now with live like counts for every post
----------------------------------------------------------------- */
async function loadPosts() {
  const { data: posts, error } = await supabaseClient
    .from('posts')
    .select(`
      id,
      content,
      created_at,
      user_id,
      profiles!inner(username)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('⛔ loadPosts error:', error);
    return;
  }

  if (!posts?.length) {
    feedEl.innerHTML = '<p>🗒️ No posts yet – be the first!</p>';
    return;
  }

  // -------------------------------------------------
  // 1️⃣  Get all post IDs for the posts we just fetched
  const postIds = posts.map(p => p.id);

  // 2️⃣  ONE request that fetches **all likes** for those posts
  const { data: likeRows, error: likeErr } = await supabaseClient
    .from('likes')
    .select('post_id')
    .in('post_id', postIds);

  if (likeErr) console.warn('Could not fetch like rows', likeErr);

  // Build a map: postId → count (default 0)
  const likesMap = {};
  if (likeRows) {
    // initialise all to 0 first (so posts with no likes are present)
    postIds.forEach(id => {
      likesMap[id] = 0;
      likeCountCache[id] = 0;   // prime the cache
    });
    // count occurrences
    likeRows.forEach(row => {
      likesMap[row.post_id] = (likesMap[row.post_id] || 0) + 1;
      likeCountCache[row.post_id] = likesMap[row.post_id];
    });
  }

  // -------------------------------------------------
  // 3️⃣  Render the feed, using the computed counts
  feedEl.innerHTML = posts.map(p => {
    const name = (p.profiles?.username ?? p.username ?? 'anon').split('@')[0];
    const postId = p.id;
    const likeCount = likesMap[postId] ?? 0;

    return `
      <div class="post" data-post-id="${postId}">
        <b class="usernameLink" data-username="${name}">${name}</b> @
        <i>${new Date(p.created_at).toLocaleString()}</i><br>
        ${p.content}<br>
        <button class="likeBtn" data-post-id="${postId}" data-liked="false">
          Likes <span class="likeCount">${likeCount}</span>
        </button>
      </div>`;
  }).join('');
}

/* -----------------------------------------------------------------
   1️⃣2️⃣  GLOBAL click delegation (feed & profile)
----------------------------------------------------------------- */
feedEl.addEventListener('click', async e => {
  // ---------- LIKE BUTTON ----------
  if (e.target.classList.contains('likeBtn')) {
    const btn = e.target;
    const postId = btn.dataset.postId;
    await toggleLike(postId, btn);
    return;
  }

  // ---------- USERNAME LINK ----------
  if (e.target.classList.contains('usernameLink')) {
    const uname = e.target.dataset.username;
    location.hash = '#profile/' + encodeURIComponent(uname);
    return;
  }
});

/* -----------------------------------------------------------------
   1️⃣3️⃣  ROUTER – hash based navigation
----------------------------------------------------------------- */
function router() {
  const hash = location.hash;

  if (hash.startsWith('#profile/')) {
    const raw = hash.slice('#profile/'.length);
    const username = decodeURIComponent(raw);
    showProfilePage(username);
  } else {
    // global timeline
    profileEl.style.display = 'none';
    feedEl.style.display    = 'block';
    postFormEl.style.display = currentUserId ? 'block' : 'none';
  }
}
window.addEventListener('hashchange', router);
window.addEventListener('load', router);

/* -----------------------------------------------------------------
   1️⃣4️⃣  PERSONAL PAGE – fetch profile + posts + live like counts
----------------------------------------------------------------- */
async function showProfilePage(username) {
  // hide global feed, show profile container
  feedEl.style.display    = 'none';
  profileEl.style.display = 'block';

  // -------------------------------------------------
  // 1️⃣  Look up the profile row by username (case‑insensitive)
  const { data: prof, error: profErr } = await supabaseClient
    .from('profiles')
    .select('id, username, avatar_url, bio')
    .ilike('username', username)
    .single();

  if (profErr || !prof) {
    profileEl.innerHTML = `<p>👻 Profile not found.</p>`;
    return;
  }

  // -------------------------------------------------
  // 2️⃣  Fetch the posts authored by this user
  const { data: userPosts, error: postsErr } = await supabaseClient
    .from('posts')
    .select('id, content, created_at')
    .eq('user_id', prof.id)
    .order('created_at', { ascending: false });

  if (postsErr) console.error('Error loading user posts:', postsErr);

  // -------------------------------------------------
  // 3️⃣  ONE request that fetches ALL likes for *all* of those posts
  const likesMap = {};
  if (userPosts?.length) {
    const postIds = userPosts.map(p => p.id);

    // prime cache for all ids (even those with zero likes)
    postIds.forEach(id => {
      likesMap[id] = 0;
      likeCountCache[id] = 0;
    });

    const { data: likeRows, error: likeErr } = await supabaseClient
      .from('likes')
      .select('post_id')
      .in('post_id', postIds);

    if (likeErr) console.warn('Could not fetch profile‑page likes', likeErr);
    else {
      likeRows.forEach(row => {
        likesMap[row.post_id] = (likesMap[row.post_id] || 0) + 1;
        likeCountCache[row.post_id] = likesMap[row.post_id];
      });
    }
  }

  // -------------------------------------------------
  // 4️⃣  Total likes received (sum of the per‑post counts)
  const totalLikes = Object.values(likesMap).reduce((a, b) => a + b, 0);

  // -------------------------------------------------
  // 5️⃣  Render the profile UI
  const isOwner = currentUserId && currentUserId === prof.id;
  const avatarImg = prof.avatar_url
    ? `<img src="${prof.avatar_url}" alt="avatar" class="avatar">`
    : `<div class="avatar placeholder">?</div>`;

  const editButton = isOwner
    ? `<button id="editProfileBtn">✏️ Edit profile</button>`
    : '';

  const postsHTML = userPosts?.map(p => {
    const likeCount = likesMap[p.id] ?? 0;
    return `
      <div class="post" data-post-id="${p.id}">
        ${p.content}<br>
        <i>${new Date(p.created_at).toLocaleString()}</i>
        <button class="likeBtn" data-post-id="${p.id}" data-liked="false">
          🤍 <span class="likeCount">${likeCount}</span>
        </button>
      </div>`;
  }).join('') ?? '<p>No posts yet.</p>';

  profileEl.innerHTML = `
    <div class="profile-header">
      ${avatarImg}
      <h2>${prof.username}</h2>
      <p>${prof.bio ?? ''}</p>
      <p>👍 ${totalLikes} likes received</p>
      ${editButton}
    </div>
    <hr>
    <div class="profile-posts">
      ${postsHTML}
    </div>
  `;

  // -------------------------------------------------
  // 6️⃣  Owner‑only edit UI
  if (isOwner) {
    document.getElementById('editProfileBtn').onclick = () => openEditModal(prof);
  }

  // -------------------------------------------------
  // 7️⃣  Delegate like clicks inside the profile container
  profileEl.addEventListener('click', async e => {
    if (e.target.classList.contains('likeBtn')) {
      const btn = e.target;
      const postId = btn.dataset.postId;
      await toggleLike(postId, btn);
    }
    // username links inside profile page (optional)
    if (e.target.classList.contains('usernameLink')) {
      const uname = e.target.dataset.username;
      location.hash = '#profile/' + encodeURIComponent(uname);
    }
  });
}

/* -----------------------------------------------------------------
   1️⃣5️⃣  EDIT PROFILE MODAL (owner only)
----------------------------------------------------------------- */
function openEditModal(currentProfile) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Edit Profile</h3>
      <label>Username: <input id="editUsername" value="${currentProfile.username}" maxlength="30"></label><br>
      <label>Avatar URL: <input id="editAvatar" value="${currentProfile.avatar_url ?? ''}"></label><br>
      <label>Bio:<br><textarea id="editBio" rows="4">${currentProfile.bio ?? ''}</textarea></label><br>
      <button id="saveProfileBtn">Save</button>
      <button id="cancelProfileBtn">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('cancelProfileBtn').onclick = () => modal.remove();

  document.getElementById('saveProfileBtn').onclick = async () => {
    const newUsername = document.getElementById('editUsername').value.trim();
    const newAvatar   = document.getElementById('editAvatar').value.trim();
    const newBio      = document.getElementById('editBio').value.trim();

    if (!newUsername) return alert('Username cannot be empty.');
    if (!newUsername.match(/^[a-z0-9_]{3,30}$/i))
      return alert('Invalid username (letters, numbers, underscores, 3‑30 chars).');

    const { error } = await supabaseClient
      .from('profiles')
      .update({
        username: newUsername,
        avatar_url: newAvatar || null,
        bio: newBio || null
      })
      .eq('id', currentProfile.id);

    if (error) return alert('Error saving profile: ' + error.message);

    alert('Profile updated!');
    modal.remove();

    if (currentUserId === currentProfile.id) {
      headerUsername.textContent = ` @${newUsername}`;
      location.hash = location.hash; // force router to re‑render profile page
    }
  };
}

/* -----------------------------------------------------------------
   1️⃣6️⃣  Periodic refresh of the global feed (every 10 s)
----------------------------------------------------------------- */
setInterval(loadPosts, 10_000);   // use function reference, not a call

/* -----------------------------------------------------------------
   1️⃣7️⃣  Initial UI state – try to restore a session from supabaseClient
----------------------------------------------------------------- */
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await afterLogin();
  } else {
    authEl.style.display = 'block';
    postFormEl.style.display = 'none';
    feedEl.style.display = 'block';
  }
  // Load the feed for everyone (guest view works as well)
  loadPosts();
})();
