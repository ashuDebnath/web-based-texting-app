const groupModel = require('../models/groupModel');
const inviteModel = require('../models/inviteModel');
const userModel = require('../models/userModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Create a new group. Optionally accepts `members`: an array of
 * { userId, wrappedGroupKey } so the creator can distribute the E2E group
 * key (encrypted to each invitee's public RSA key) at creation time.
 */
const createGroup = asyncHandler(async (req, res) => {
  const { name, isDirect = false, members = [], myWrappedGroupKey = null } = req.body || {};
  if (!name || typeof name !== 'string') {
    throw new ApiError(400, 'name is required');
  }

  const allMembers = [
    { userId: req.user.id, role: 'owner', wrappedGroupKey: myWrappedGroupKey },
    ...members.map((m) => ({
      userId: m.userId,
      role: 'member',
      wrappedGroupKey: m.wrappedGroupKey || null,
    })),
  ];

  const group = await groupModel.createGroupWithMembers({
    name,
    isDirect: Boolean(isDirect),
    createdBy: req.user.id,
    members: allMembers,
  });

  const fullMembers = await groupModel.getGroupMembers(group.id);
  res.status(201).json({ group, members: fullMembers });
});

const listMyGroups = asyncHandler(async (req, res) => {
  const groups = await groupModel.getUserGroups(req.user.id);
  res.json({ groups });
});

const getGroup = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const isMember = await groupModel.isMember(groupId, req.user.id);
  if (!isMember) throw new ApiError(403, 'You are not a member of this group');

  const group = await groupModel.findGroupById(groupId);
  if (!group) throw new ApiError(404, 'Group not found');

  const members = await groupModel.getGroupMembers(groupId);
  const myMembership = await groupModel.getMembership(groupId, req.user.id);
  res.json({ group, members, myMembership });
});

const leaveGroup = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const isMember = await groupModel.isMember(groupId, req.user.id);
  if (!isMember) throw new ApiError(403, 'You are not a member of this group');
  await groupModel.removeMember(groupId, req.user.id);
  res.json({ success: true });
});

/**
 * Create a shareable invite link for a group. Any current member can
 * create one (role checks could be tightened to owner/admin if desired).
 */
const createInvite = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { maxUses = null, expiresInHours = null } = req.body || {};

  const isMember = await groupModel.isMember(groupId, req.user.id);
  if (!isMember) throw new ApiError(403, 'You are not a member of this group');

  const expiresAt = expiresInHours
    ? new Date(Date.now() + Number(expiresInHours) * 60 * 60 * 1000)
    : null;

  const invite = await inviteModel.createInviteLink({
    groupId,
    createdBy: req.user.id,
    maxUses: maxUses ? Number(maxUses) : null,
    expiresAt,
  });

  res.status(201).json({ invite });
});

const listInvites = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const isMember = await groupModel.isMember(groupId, req.user.id);
  if (!isMember) throw new ApiError(403, 'You are not a member of this group');
  const invites = await inviteModel.listForGroup(groupId);
  res.json({ invites });
});

const revokeInvite = asyncHandler(async (req, res) => {
  const { inviteId } = req.params;
  const revoked = await inviteModel.revoke(inviteId, req.user.id);
  if (!revoked) throw new ApiError(404, 'Invite not found or you are not its creator');
  res.json({ invite: revoked });
});

/**
 * Preview an invite link (group name, member count) WITHOUT joining yet.
 * Used by the client to show "You're about to join X" before confirming.
 */
const previewInvite = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const invite = await inviteModel.findByToken(token);
  if (!invite || !inviteModel.isInviteValid(invite)) {
    throw new ApiError(404, 'Invite link is invalid, expired, or has reached its use limit');
  }
  const group = await groupModel.findGroupById(invite.group_id);
  const members = await groupModel.getGroupMembers(invite.group_id);
  res.json({
    group: { id: group.id, name: group.name, isDirect: group.is_direct },
    memberCount: members.length,
  });
});

/**
 * Join a group via invite token. Because the group's symmetric AES key is
 * E2E-wrapped per-member, the joining client must supply `wrappedGroupKey`
 * — the group key re-encrypted to *their own* public key. To do that, the
 * client first calls previewInvite to get an existing member's public key
 * bundle... but since the server never sees the unwrapped key, in practice
 * the client obtains the plaintext group key out-of-band (e.g. an existing
 * member shares it via a already-encrypted channel/QR, or for simpler
 * deployments the group uses a link-derived passphrase). This endpoint
 * accepts whatever wrappedGroupKey the client provides (may be null for
 * unencrypted/public groups) and adds the user as a member.
 */
const joinViaInvite = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { wrappedGroupKey = null } = req.body || {};

  const invite = await inviteModel.findByToken(token);
  if (!invite || !inviteModel.isInviteValid(invite)) {
    throw new ApiError(404, 'Invite link is invalid, expired, or has reached its use limit');
  }

  const alreadyMember = await groupModel.isMember(invite.group_id, req.user.id);
  if (!alreadyMember) {
    await groupModel.addMember({
      groupId: invite.group_id,
      userId: req.user.id,
      role: 'member',
      wrappedGroupKey,
    });
    await inviteModel.incrementUse(invite.id);

    // If the joiner couldn't supply a wrapped key (the normal case for a
    // cold link-join, since they have no prior relationship with any
    // member to exchange it directly), ask any currently-online member to
    // re-wrap the group key for them. Whichever online member's client
    // receives this first will compute the wrap and call
    // PUT /groups/:groupId/members/:userId/key to deliver it.
    if (!wrappedGroupKey) {
      const io = req.app.get('io');
      if (io) {
        const joiningUser = await userModel.findById(req.user.id);
        io.to(`group:${invite.group_id}`).emit('group:key-request', {
          groupId: invite.group_id,
          userId: req.user.id,
          publicKey: joiningUser?.public_key || null,
        });
      }
    }
  }

  const group = await groupModel.findGroupById(invite.group_id);
  const members = await groupModel.getGroupMembers(invite.group_id);
  res.json({ group, members });
});

const getGroupMembersHandler = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const isMember = await groupModel.isMember(groupId, req.user.id);
  if (!isMember) throw new ApiError(403, 'You are not a member of this group');
  const members = await groupModel.getGroupMembers(groupId);
  res.json({ members });
});

/**
 * Delivers a re-wrapped copy of the group's symmetric key to a specific
 * member. Called by an existing, already-unlocked member's client in
 * response to a 'group:key-request' socket event (see joinViaInvite),
 * so a cold link-join still ends up end-to-end encrypted without ever
 * exposing the plaintext key to the server.
 */
const shareGroupKey = asyncHandler(async (req, res) => {
  const { groupId, userId } = req.params;
  const { wrappedGroupKey } = req.body || {};
  if (!wrappedGroupKey) throw new ApiError(400, 'wrappedGroupKey is required');

  const requesterIsMember = await groupModel.isMember(groupId, req.user.id);
  if (!requesterIsMember) throw new ApiError(403, 'You are not a member of this group');

  const targetIsMember = await groupModel.isMember(groupId, userId);
  if (!targetIsMember) throw new ApiError(404, 'Target user is not a member of this group');

  const updated = await groupModel.setWrappedGroupKey(groupId, userId, wrappedGroupKey);

  const io = req.app.get('io');
  if (io) {
    io.to(`user:${userId}`).emit('group:key-delivered', { groupId });
  }

  res.json({ membership: updated });
});

module.exports = {
  createGroup,
  listMyGroups,
  getGroup,
  leaveGroup,
  createInvite,
  listInvites,
  revokeInvite,
  previewInvite,
  joinViaInvite,
  getGroupMembersHandler,
  shareGroupKey,
};
